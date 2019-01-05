import { isNil } from 'lodash';
import { Inject } from 'noicejs';
import { Connection, In, Repository } from 'typeorm';

import { CheckRBAC, Handler } from 'src/controller';
import { BaseController, ErrorReplyType } from 'src/controller/BaseController';
import { Controller, ControllerData, ControllerOptions } from 'src/controller/Controller';
import { createCompletion } from 'src/controller/helpers';
import { Role } from 'src/entity/auth/Role';
import { Token } from 'src/entity/auth/Token';
import { User } from 'src/entity/auth/User';
import { UserRepository } from 'src/entity/auth/UserRepository';
import { Command, CommandVerb } from 'src/entity/Command';
import { Context } from 'src/entity/Context';
import { mustExist } from 'src/utils';
import { Clock } from 'src/utils/Clock';

export const NOUN_GRANT = 'grant';
export const NOUN_ACCOUNT = 'account';
export const NOUN_SESSION = 'session';

export interface AccountControllerData extends ControllerData {
  join: {
    allow: boolean;
    grants: Array<string>;
    roles: Array<string>;
  };
  root: {
    allow: boolean;
    name: string;
    roles: Array<string>;
  };
  token: {
    audience: Array<string>;
    duration: number;
    issuer: string;
    secret: string;
  };
}

export type AccountControllerOptions = ControllerOptions<AccountControllerData>;

@Inject('clock', 'storage')
export class AccountController extends BaseController<AccountControllerData> implements Controller {
  protected clock: Clock;
  protected storage: Connection;
  protected roleRepository: Repository<Role>;
  protected tokenRepository: Repository<Token>;
  protected userRepository: UserRepository;

  constructor(options: AccountControllerOptions) {
    super(options, 'isolex#/definitions/service-controller-account', [NOUN_GRANT, NOUN_ACCOUNT, NOUN_SESSION]);

    this.clock = options.clock;
    this.storage = options.storage;
    this.roleRepository = this.storage.getRepository(Role);
    this.tokenRepository = this.storage.getRepository(Token);
    this.userRepository = this.storage.getCustomRepository(UserRepository);
  }

  @Handler(NOUN_GRANT, CommandVerb.Get)
  @CheckRBAC()
  public async getGrant(cmd: Command): Promise<void> {
    const ctx = mustExist(cmd.context);
    const grants = cmd.get('grants');
    const results = grants.map((p) => {
      return `\`${p}: ${ctx.checkGrants([p])}\``;
    }).join('\n');
    return this.reply(ctx, results);
  }

  @Handler(NOUN_GRANT, CommandVerb.List)
  @CheckRBAC()
  public async listGrants(cmd: Command): Promise<void> {
    const ctx = mustExist(cmd.context);
    const grants = cmd.get('grants');
    const results = grants.map((p) => {
      return `\`${p}: ${ctx.listGrants([p])}\``;
    }).join('\n');
    return this.reply(ctx, results);
  }

  @Handler(NOUN_ACCOUNT, CommandVerb.Create)
  public async createAccount(cmd: Command, ctx: Context): Promise<void> {
    if (!this.data.join.allow && !this.checkGrants(ctx, 'account:create')) {
      return this.errorReply(ctx, ErrorReplyType.GrantMissing);
    }

    const name = cmd.getHeadOrDefault('name', ctx.name);
    const existing = await this.userRepository.count({
      name,
    });
    if (existing > 0) {
      return this.reply(ctx, `user ${name} already exists`);
    }

    const roleNames = this.getUserRoles(name);
    const roles = await this.roleRepository.find({
      where: {
        name: In(roleNames),
      },
    });
    const user = await this.userRepository.save(new User({
      name,
      roles,
    }));

    const jwt = await this.createToken(user);
    return this.reply(ctx, `user ${name} joined, sign in token: ${jwt}`);
  }

  @Handler(NOUN_ACCOUNT, CommandVerb.Delete)
  @CheckRBAC()
  public async deleteAccount(cmd: Command, ctx: Context): Promise<void> {
    const user = this.getUserOrFail(ctx);
    if (cmd.getHeadOrDefault('confirm', 'no') !== 'yes') {
      const completion = createCompletion(cmd, 'confirm', `please confirm deleting all tokens for ${user.name}`);
      await this.bot.executeCommand(completion);
      return;
    }

    await this.tokenRepository.delete({
      subject: user.id,
    });

    const jwt = await this.createToken(user);
    return this.reply(ctx, `revoked tokens for ${user.name}, new sign in token: ${jwt}`);
  }

  @Handler(NOUN_SESSION, CommandVerb.Create)
  public async createSession(cmd: Command, ctx: Context): Promise<void> {
    const jwt = cmd.getHead('token');
    const token = Token.verify(jwt, this.data.token.secret, {
      audience: this.data.token.audience,
      issuer: this.data.token.issuer,
    });
    this.logger.debug({ token }, 'creating session from token');

    const user = await this.userRepository.findOneOrFail({
      id: token.sub,
    });
    await this.userRepository.loadRoles(user);
    this.logger.debug({ user }, 'logging in user');

    const source = this.getSourceOrFail(ctx);
    const session = await source.createSession(ctx.uid, user);
    this.logger.debug({ session, user }, 'created session');
    return this.reply(ctx, 'created session');
  }

  @Handler(NOUN_SESSION, CommandVerb.Get)
  @CheckRBAC()
  public async getSession(cmd: Command, ctx: Context): Promise<void> {
    const source = this.getSourceOrFail(ctx);
    const session = source.getSession(ctx.uid);
    if (isNil(session)) {
      return this.reply(ctx, 'cannot get sessions unless logged in');
    }

    return this.reply(ctx, session.toString());
  }

  protected async createToken(user: User): Promise<string> {
    const issued = this.clock.getSeconds();
    const expires = issued + this.data.token.duration;
    this.logger.debug({ expires, issued }, 'creating token');

    const tokenPre = new Token({
      audience: this.data.token.audience,
      createdAt: this.clock.getDate(issued),
      data: {},
      expiresAt: this.clock.getDate(expires),
      grants: this.data.join.grants,
      issuer: this.data.token.issuer,
      labels: {},
      subject: user.id,
      user,
    });

    const token = await this.tokenRepository.save(tokenPre);
    this.logger.debug({ expires, issued, token }, 'signing token');
    return token.sign(this.data.token.secret);
  }

  protected getUserRoles(name: string): Array<string> {
    const roles = Array.from(this.data.join.roles);
    if (this.data.root.allow && name === this.data.root.name) {
      roles.push(...this.data.root.roles);
      this.logger.warn({ roles, user: name }, 'granting root roles to user');
    }
    return roles;
  }
}
