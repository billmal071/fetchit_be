import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShopperService } from './shopper.service';
import {
  ExtraServiceResponseDto,
  ShoppingCategoryResponseDto,
  ShoppingLocationResponseDto,
} from './dto';
import { Public } from '@common/decorators/public.decorator';
import { ApiErrorResponses, ApiSuccessResponse } from '@/common/decorators';

/**
 * The lookups the onboarding form is built from. Public, like
 * GET /service-categories, so they live in their own controller: a class-level
 * `@Roles` on ShopperController would otherwise reject the anonymous callers.
 */
@ApiTags('Shopper')
@Controller('shopper')
export class ShopperReferenceController {
  constructor(private readonly shopperService: ShopperService) {}

  @Get('categories')
  @Public()
  @ApiOperation({ summary: 'List active shopping categories', description: 'No authentication.' })
  @ApiSuccessResponse(ShoppingCategoryResponseDto, true)
  @ApiErrorResponses()
  async categories(): Promise<{ data: ShoppingCategoryResponseDto[] }> {
    return { data: await this.shopperService.listCategories() };
  }

  @Get('locations')
  @Public()
  @ApiOperation({ summary: 'List active shopping locations', description: 'No authentication.' })
  @ApiSuccessResponse(ShoppingLocationResponseDto, true)
  @ApiErrorResponses()
  async locations(): Promise<{ data: ShoppingLocationResponseDto[] }> {
    return { data: await this.shopperService.listLocations() };
  }

  @Get('services')
  @Public()
  @ApiOperation({
    summary: 'List active extra services',
    description: 'Each carries the Fetchit-configured fee. No authentication.',
  })
  @ApiSuccessResponse(ExtraServiceResponseDto, true)
  @ApiErrorResponses()
  async services(): Promise<{ data: ExtraServiceResponseDto[] }> {
    return { data: await this.shopperService.listServices() };
  }
}
