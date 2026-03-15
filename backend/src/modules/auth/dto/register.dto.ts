import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'Full name must not exceed 255 characters' })
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'Tenant name must not exceed 255 characters' })
  tenantName!: string;
}
