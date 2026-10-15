import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const BILD = /^(https?:\/\/|\/)\S+$/;

export class CreateContactDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) role!: string;
  @ApiProperty() @IsString() @MaxLength(2000) description!: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @ApiProperty() @IsString() @MaxLength(300) location!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(BILD) @MaxLength(2000) image_url?: string | null;
}
export class UpdateContactDto extends PartialType(CreateContactDto) {}
