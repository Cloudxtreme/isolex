import { Inject } from 'noicejs';
import { Connection, Repository } from 'typeorm';

import { BaseController } from 'src/controller/BaseController';
import { Controller, ControllerConfig, ControllerOptions } from 'src/controller/Controller';
import { Command } from 'src/entity/Command';
import { Message } from 'src/entity/Message';
import { Keyword } from 'src/entity/misc/Keyword';

export interface LearnControllerConfig extends ControllerConfig {
  emit: {
    field: string;
    source: string;
    value: string;
  };
  mode: {
    create: string;
    delete: string;
    execute: string;
  };
}

export interface LearnControllerOptions extends ControllerOptions<LearnControllerConfig> {
  storage: Connection;
}

@Inject('storage')
export class LearnController extends BaseController<LearnControllerConfig> implements Controller {
  protected storage: Connection;
  protected keywordRepository: Repository<Keyword>;

  constructor(options: LearnControllerOptions) {
    super(options);

    this.storage = options.storage;
    this.keywordRepository = this.storage.getRepository(Keyword);
  }

  public async handle(cmd: Command): Promise<void> {
    const args: Array<string> = cmd.get('args');
    if (!args) {
      throw new Error('missing args to learn controller');
    }

    const [keyword, ...body] = args;

    this.logger.debug({ body, keyword }, 'handling learned keyword');

    switch (cmd.verb) {
      case this.config.mode.create:
        return this.createKeyword(keyword, body, cmd);
      case this.config.mode.delete:
        return this.deleteKeyword(keyword, cmd);
      case this.config.mode.execute:
        return this.executeKeyword(keyword, body, cmd);
      default:
        return this.executeKeyword(keyword, body, cmd);
    }
  }

  protected async createKeyword(name: string, args: Array<string>, cmd: Command): Promise<void> {
    const keyword = Keyword.create({
      command: Command.create({
        context: cmd.context,
        data: { args },
        noun: cmd.noun,
        verb: cmd.verb,
      }),
      controller: this.name,
      name,
    });

    this.logger.debug({ args, cmd, name, keyword }, 'learning command');

    if (await this.keywordRepository.findOne(name)) {
      return this.bot.send(Message.reply(`Command already exists: ${name}`, cmd.context));
    }

    await this.keywordRepository.save(keyword);

    return this.bot.send(Message.reply(`Learned command ${name}.`, cmd.context));
  }

  protected async deleteKeyword(name: string, cmd: Command) {
    const keyword = await this.keywordRepository.findOne(name);

    if (!keyword) {
      return this.bot.send(Message.reply(`Command ${name} does not exist.`, cmd.context));
    }

    await this.keywordRepository.delete(name);

    return this.bot.send(Message.reply(`Deleted command ${name}.`, cmd.context));
  }

  protected async executeKeyword(name: string, body: Array<string>, cmd: Command) {
    const keyword = await this.keywordRepository.findOne(name, {
      relations: ['command', 'command.context'],
    });

    if (!keyword || !keyword.command) {
      throw new Error('missing keyword or command');
    }

    const [noun, ...args] = body;

    this.logger.debug({ args, noun }, 'building command');

    const emit = keyword.command.extend({
      context: cmd.context,
      data: {
        [this.config.emit.field]: args,
      },
      noun,
    });

    this.logger.debug({ emit, keyword }, 'keywording command');

    return this.bot.handle(emit);
  }
}
