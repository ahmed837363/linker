import { IsInt, Min, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStockDto {
  @IsInt()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
