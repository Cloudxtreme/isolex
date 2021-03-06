import { Container, Logger, Module } from 'noicejs';
import * as sourceMapSupport from 'source-map-support';
import * as yargs from 'yargs-parser';

import { Bot, BotOptions } from 'src/Bot';
import { loadConfig } from 'src/config';
import { BotModule } from 'src/module/BotModule';
import { ControllerModule } from 'src/module/ControllerModule';
import { EntityModule } from 'src/module/EntityModule';
import { FilterModule } from 'src/module/FilterModule';
import { IntervalModule } from 'src/module/IntervalModule';
import { ListenerModule } from 'src/module/ListenerModule';
import { MigrationModule } from 'src/module/MigrationModule';
import { ParserModule } from 'src/module/ParserModule';
import { ServiceModule } from 'src/module/ServiceModule';
import { TransformModule } from 'src/module/TransformModule';
import { Schema } from 'src/schema';
import { ServiceEvent } from 'src/Service';
import { BunyanLogger } from 'src/utils/BunyanLogger';
import { signal, SIGNAL_RELOAD, SIGNAL_RESET, SIGNAL_STOP } from 'src/utils/Signal';

// main arguments
const CONFIG_ARGS_NAME = 'config-name';
const CONFIG_ARGS_PATH = 'config-path';
const MAIN_ARGS: yargs.Options = {
  array: [CONFIG_ARGS_PATH],
  boolean: ['test'],
  count: ['v'],
  default: {
    [CONFIG_ARGS_NAME]: '.isolex.yml',
    [CONFIG_ARGS_PATH]: [],
  },
  envPrefix: 'isolex',
};

const MAIN_MODULES = [
  ControllerModule,
  EntityModule,
  FilterModule,
  IntervalModule,
  ListenerModule,
  ParserModule,
  ServiceModule,
  TransformModule,
];

// webpack environment defines
declare const BUILD_JOB: string;
declare const BUILD_RUNNER: string;
declare const GIT_BRANCH: string;
declare const GIT_COMMIT: string;
declare const NODE_VERSION: string;
declare const WEBPACK_VERSION: string;

const VERSION_INFO = {
  build: {
    job: BUILD_JOB,
    node: NODE_VERSION,
    runner: BUILD_RUNNER,
    webpack: WEBPACK_VERSION,
  },
  git: {
    branch: GIT_BRANCH,
    commit: GIT_COMMIT,
  },
};

sourceMapSupport.install({
  environment: 'node',
  handleUncaughtExceptions: true,
  hookRequire: true,
});

const STATUS_SUCCESS = 0;
const STATUS_ERROR = 1;

function createModules(botModule: BotModule, migrate: boolean) {
  const modules: Array<Module> = [
    botModule,
  ];

  for (const m of MAIN_MODULES) {
    modules.push(new m());
  }

  if (migrate) {
    modules.push(new MigrationModule());
  }

  return modules;
}

async function handleSignals(bot: Bot, logger: Logger) {
  await bot.start();
  await bot.notify(ServiceEvent.Start);

  const signals = [SIGNAL_RELOAD, SIGNAL_RESET, SIGNAL_STOP];
  let s = await signal(...signals);
  while (s !== SIGNAL_STOP) {
    switch (s) {
      case SIGNAL_RELOAD:
        await bot.notify(ServiceEvent.Reload);
        break;
      case SIGNAL_RESET:
        await bot.notify(ServiceEvent.Reset);
        break;
      default:
        logger.warn({ signal: s }, 'unknown signal received');
    }
    s = await signal(...signals);
  }

  await bot.notify(ServiceEvent.Stop);
  await bot.stop();
}

async function main(argv: Array<string>): Promise<number> {
  const args = yargs(argv, MAIN_ARGS);
  const config = await loadConfig(args[CONFIG_ARGS_NAME], ...args[CONFIG_ARGS_PATH]);

  const logger = BunyanLogger.create(config.data.logger);
  logger.info(VERSION_INFO, 'version info');
  logger.info({ args }, 'main arguments');

  const schema = new Schema();
  const result = schema.match(config);
  if (!result.valid) {
    logger.error({ errors: result.errors }, 'config failed to validate');
    return STATUS_ERROR;
  }

  if (args.test) {
    logger.info('config is valid');
    return STATUS_SUCCESS;
  }

  const botModule = new BotModule({ logger });
  const ctr = Container.from(...createModules(botModule, config.data.migrate));
  logger.info('configuring container');
  await ctr.configure({ logger });

  const bot = await ctr.create<Bot, BotOptions>(Bot, config);
  botModule.setBot(bot);

  logger.info('starting bot');
  await handleSignals(bot, logger);

  return STATUS_SUCCESS;
}

main(process.argv).then((status) => process.exit(status)).catch((err) => {
  /* tslint:disable-next-line:no-console */
  console.error('uncaught error during main:', err);
  process.exit(STATUS_ERROR);
});
