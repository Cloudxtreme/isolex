import { Module, ModuleOptions, Provides } from 'noicejs';
import { Container } from 'noicejs/Container';

import { BaseServiceData, INJECT_LOGGER, INJECT_SERVICES } from 'src/BaseService';
import { BotServiceOptions } from 'src/BotService';
import { NotFoundError } from 'src/error/NotFoundError';
import { Service, ServiceDefinition, ServiceEvent, ServiceLifecycle, ServiceMetadata } from 'src/Service';
import { mustExist } from 'src/utils';
import { mustGet } from 'src/utils/Map';

/**
 * This is a magical half-module service locator
 */

export class ServiceModule extends Module implements ServiceLifecycle {
  protected container?: Container;
  protected services: Map<string, Service>;

  constructor() {
    super();

    this.services = new Map();
  }

  public get size(): number {
    return this.services.size;
  }

  public async notify(event: ServiceEvent) {
    for (const svc of this.services.values()) {
      await svc.notify(event);
    }
  }

  public async start() {
    for (const svc of this.services.values()) {
      await svc.start();
    }
  }

  public async stop() {
    for (const svc of this.services.values()) {
      await svc.stop();
    }
    this.services.clear();
  }

  public async configure(options: ModuleOptions): Promise<void> {
    await super.configure(options);
    this.container = options.container;
    this.logger.debug({ options }, 'configuring service module');
  }

  @Provides(INJECT_SERVICES)
  public getServices() {
    this.logger.debug('getting services from service module');
    return this;
  }

  /**
   * These are all created the same way, so they should probably have a common base...
   */
  public async createService<TService extends Service, TData extends BaseServiceData>(conf: ServiceDefinition<TData>): Promise<TService> {
    const container = mustExist(this.container);

    const { metadata: { kind, name } } = conf;
    const tag = `${kind}:${name}`;

    if (this.services.has(tag)) {
      this.logger.info({ kind, tag }, 'fetching existing service');
      return mustGet(this.services, tag) as TService;
    }

    this.logger.info({ kind, tag }, 'creating unknown service');
    const svc = await container.create<TService, BotServiceOptions<TData>>(kind, {
      ...conf,
      [INJECT_LOGGER]: this.logger.child({
        kind,
      }),
      [INJECT_SERVICES]: this,
    });

    this.logger.debug({ id: svc.id, kind, tag }, 'service created');
    this.services.set(tag, svc);

    return svc;
  }

  public getService<TService extends Service>(metadata: Partial<ServiceMetadata>): TService {
    for (const svc of this.services.values()) {
      if (svc.id === metadata.id || (svc.kind === metadata.kind && svc.name === metadata.name)) {
        return svc as TService;
      }
    }

    this.logger.error({ metadata }, 'service not found');
    throw new NotFoundError(`service not found`);
  }

  public listServices() {
    this.logger.debug('listing services');
    return this.services;
  }
}
