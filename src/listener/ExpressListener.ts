import * as express from 'express';
import * as expressGraphQl from 'express-graphql';
import { buildSchema } from 'graphql';
import * as http from 'http';
import { Inject } from 'noicejs';
import { Counter, Registry } from 'prom-client';
import { Connection } from 'typeorm';

import { ChildServiceOptions } from 'src/ChildService';
import { Command } from 'src/entity/Command';
import { Context } from 'src/entity/Context';
import { Message } from 'src/entity/Message';
import { NotImplementedError } from 'src/error/NotImplementedError';
import { ServiceModule } from 'src/module/ServiceModule';
import { pairsToDict } from 'src/utils/Map';

import { BaseListener } from './BaseListener';
import { Listener } from './Listener';

const schema = buildSchema(require('../schema.gql'));

export interface ExpressListenerData {
  expose: {
    graph: boolean;
    graphiql: boolean;
    metrics: boolean;
  }
  listen: {
    address: string;
    port: number;
  };
}

export type ExpressListenerOptions = ChildServiceOptions<ExpressListenerData>;

@Inject('bot', 'metrics', 'services', 'storage')
export class ExpressListener extends BaseListener<ExpressListenerData> implements Listener {
  protected readonly metrics: Registry;
  protected readonly services: ServiceModule;
  protected readonly storage: Connection;

  protected requestCounter: Counter;

  protected app: express.Express;
  protected server?: http.Server;

  constructor(options: ExpressListenerOptions) {
    super(options);

    this.metrics = options.metrics;
    this.services = options.services;
    this.storage = options.storage;

    this.app = express();

    if (this.data.expose.metrics) {
      this.app.use((req, res, next) => this.traceRequest(req, res, next));
      this.app.get('/metrics', (req, res) => this.getMetrics(req, res));
    }

    if (this.data.expose.graph) {
      this.app.use('/graph', expressGraphQl({
        graphiql: this.data.expose.graphiql,
        rootValue: {
          // mutation
          emitCommands: (args: any) => this.emitCommands(args),
          sendMessages: (args: any) => this.sendMessages(args),
          // query
          command: (args: any) => this.getCommand(args),
          message: (args: any) => this.getCommand(args),
          service: (args: any) => this.getService(args),
          services: () => this.getServices(),
        },
        schema,
      }));
    }
  }

  public async start() {
    this.server = await new Promise<http.Server>((res, rej) => {
      let server: http.Server;
      server = this.app.listen(this.data.listen.port, this.data.listen.address, () => {
        res(server);
      });
    });

    this.requestCounter = new Counter({
      help: 'all requests through this express listener',
      labelNames: ['serviceId', 'serviceKind', 'serviceName', 'requestClient', 'requestHost', 'requestPath'],
      name: 'express_requests',
      registers: [this.metrics],
    });
  }

  public async stop() {
    if (this.server) {
      this.server.close();
    }
  }

  public async send() {
    this.logger.warn('express listener is not able to emit messages');
  }

  public async fetch(): Promise<Array<Message>> {
    this.logger.warn('express listener is not able to fetch messages');
    return [];
  }

  public emitCommands(args: any) {
    this.logger.debug({ args }, 'emit command');
    const commands = args.commands.map((data: any) => {
      const { context = {}, labels: rawLabels, noun, verb } = data;
      return new Command({
        context: this.createContext(context),
        data: args,
        labels: pairsToDict(rawLabels),
        noun,
        verb,
      });
    });
    return this.bot.emitCommand(...commands);
  }

  public sendMessages(args: any) {
    this.logger.debug({ args }, 'send message');
    const messages = args.messages.map((data: any) => {
      const { body, context = {}, type } = data;
      return new Message({
        body,
        context: this.createContext(context),
        reactions: [],
        type,
      });
    });
    return this.bot.sendMessage(...messages);
  }

  public getCommand(args: any) {
    this.logger.debug({ args }, 'get command');
    const repository = this.storage.getRepository(Command);
    const { id } = args;
    return repository.findOne(id);
  }

  public getMessage(args: any) {
    this.logger.debug({ args }, 'get message');
    const repository = this.storage.getRepository(Message);
    const { id } = args;
    return repository.findOne(id);
  }

  public getService(args: any) {
    this.logger.debug({ args }, 'getting service');
    const { id } = args;
    return this.services.getService(id);
  }

  public getServices() {
    this.logger.debug('getting services');
    try {
      return this.services.listServices();
    } catch (err) {
      this.logger.error(err, 'error getting services');
      return [];
    }
  }

  public getMetrics(req: express.Request, res: express.Response) {
    res.set('Content-Type', this.metrics.contentType);
    res.end(this.metrics.metrics());
  }

  public traceRequest(req: express.Request, res: express.Response, next: Function) {
    this.logger.debug({ req, res }, 'handling request');
    this.requestCounter.inc({
      requestClient: req.ip,
      requestHost: req.hostname,
      requestPath: req.path,
      serviceId: this.id,
      serviceKind: this.kind,
      serviceName: this.name,
    });
    next();
  }

  protected createContext(args: any): Context {
    return new Context({
      listenerId: this.id,
      roomId: args.roomId || '',
      threadId: args.threadId || '',
      userId: args.userId || '',
      userName: args.userName || '',
    });
  }
}
