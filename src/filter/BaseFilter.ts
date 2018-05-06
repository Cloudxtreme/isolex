import { Logger } from 'noicejs/logger/Logger';
import { Filter, FilterBehavior, FilterValue } from 'src/filter/Filter';
import { BaseService } from 'src/Service';

/**
 * Most filters are stateless, this implements methods for them.
 */
export abstract class BaseFilter<TConfig> extends BaseService<TConfig> implements Filter {
  public async start() {
    /* noop */
  }

  public async stop() {
    /* noop */
  }

  public abstract filter(val: FilterValue): Promise<FilterBehavior>;
}
