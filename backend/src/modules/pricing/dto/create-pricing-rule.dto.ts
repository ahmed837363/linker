import {
  IsString,
  IsOptional,
  IsObject,
  IsInt,
  IsBoolean,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePricingRuleDto {
  @IsString()
  @MaxLength(255)
  name: string;

  /**
   * Rule type, e.g. 'percentage_markup', 'fixed_markup', 'fixed_price',
   * 'percentage_discount', 'round_to'.
   */
  @IsString()
  @MaxLength(50)
  ruleType: string;

  /** If set, rule only applies to this platform. Otherwise applies to all. */
  @IsOptional()
  @IsString()
  platform?: string;

  /**
   * Conditions that must be met for the rule to apply.
   * e.g. { "category": "electronics", "minBasePrice": 10 }
   */
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  /**
   * The adjustment to apply.
   * e.g. { "type": "percentage", "value": 15 } or { "type": "fixed", "value": 5.00 }
   */
  @IsObject()
  adjustment: Record<string, unknown>;

  /** Higher priority rules are evaluated first. */
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
