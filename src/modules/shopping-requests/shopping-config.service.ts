import { Inject, Injectable } from '@nestjs/common';
import {
  IShoppingConfigRepository,
  IShoppingFeeRules,
  SHOPPING_CONFIG_REPOSITORY,
} from '@/database/repositories';
import { InternalServerException } from '@common/exceptions/base.exception';

/** The one place fee rules are read from. There are no fallback constants. */
@Injectable()
export class ShoppingConfigService {
  constructor(
    @Inject(SHOPPING_CONFIG_REPOSITORY) private readonly config: IShoppingConfigRepository,
  ) {}

  async getRules(): Promise<IShoppingFeeRules> {
    const rules = await this.config.get();
    if (!rules) {
      throw new InternalServerException('Shopping fee configuration has not been set up');
    }
    return rules;
  }
}
