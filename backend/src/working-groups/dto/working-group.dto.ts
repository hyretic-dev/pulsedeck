import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const KONTAKT_ARTEN = ['Signal', 'Discord', 'WhatsApp', 'Email'] as const;
export const AG_ROLLEN = ['member', 'admin', 'lead'] as const;

export class CreateWorkingGroupDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(5000) description!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) lead!: string;
  @ApiProperty({ description: 'Darf leer sein: die Oberfläche berechnet es aus den Terminen.' }) @IsString() @MaxLength(200) next_meeting!: string;
  @ApiProperty({ enum: KONTAKT_ARTEN }) @IsIn(KONTAKT_ARTEN) contact_type!: (typeof KONTAKT_ARTEN)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) contact_value?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) contact_link?: string | null;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) contact_icon!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) category?: string | null;
}

export class UpdateWorkingGroupDto extends PartialType(CreateWorkingGroupDto) {}

export class AgMemberRoleDto {
  @ApiProperty({ enum: AG_ROLLEN }) @IsIn(AG_ROLLEN) role!: (typeof AG_ROLLEN)[number];
}
