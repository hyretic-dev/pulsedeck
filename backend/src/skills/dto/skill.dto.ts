import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const SKILL_KATEGORIEN = ['ability', 'interest', 'availability'] as const;

export class CreateSkillDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional({ enum: SKILL_KATEGORIEN }) @IsOptional() @IsIn(SKILL_KATEGORIEN) category?: (typeof SKILL_KATEGORIEN)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) icon?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sort_order?: number;
}

export class UpdateSkillDto extends PartialType(CreateSkillDto) {}

export class SetMemberSkillsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) skill_ids!: string[];
}

export class MatchMembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) skill_ids!: string[];
}
