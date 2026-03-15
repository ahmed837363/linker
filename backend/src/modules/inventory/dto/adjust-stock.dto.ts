import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdjustStockDto {
  /** Positive to increment, negative to decrement. */
  @IsInt()
  delta: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
