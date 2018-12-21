import { Match, MatchData } from 'src/utils/match';

import { BaseFilter } from './BaseFilter';
import { Filter, FilterBehavior, FilterOptions, FilterValue } from './Filter';

export interface RuleFilterData {
  match: MatchData;
}

export abstract class RuleFilter extends BaseFilter<RuleFilterData> implements Filter {
  protected matcher: Match;

  constructor(options: FilterOptions<RuleFilterData>) {
    super(options, 'isolex#/definitions/service-filter-rule');

    this.matcher = new Match(options.data.match);
  }

  public abstract async check(value: FilterValue): Promise<FilterBehavior>;
}
