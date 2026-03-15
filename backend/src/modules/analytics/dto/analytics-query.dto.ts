import { IsOptional, IsString, IsIn } from 'class-validator';

/**
 * Query parameters shared across analytics endpoints.
 *
 * - `startDate` / `endDate` are ISO-8601 date strings (YYYY-MM-DD or full ISO).
 * - `granularity` controls the bucket size for time-series data.
 */
export class AnalyticsQueryDto {
  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: 'day' | 'week' | 'month';
}

/**
 * Query parameters for top-products endpoint.
 */
export class TopProductsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}
