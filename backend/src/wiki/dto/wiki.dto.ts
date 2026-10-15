import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const WIKI_STATI = ['Published', 'Draft', 'Review'] as const;
export const WIKI_ROLLEN = ['public', 'member', 'committee', 'admin'] as const;

export class CreateWikiDocDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
  @ApiProperty() @IsString() @MaxLength(2000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500000) content?: string | null;
  @ApiPropertyOptional({ format: 'uuid', description: 'Kategorie der Organisation' }) @IsOptional() @IsUUID() category?: string | null;
  @ApiPropertyOptional({ enum: WIKI_STATI }) @IsOptional() @IsIn(WIKI_STATI) status?: (typeof WIKI_STATI)[number];
  @ApiPropertyOptional({ enum: WIKI_ROLLEN, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(WIKI_ROLLEN, { each: true }) allowed_roles?: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string | null;
}
export class UpdateWikiDocDto extends PartialType(CreateWikiDocDto) {}

export class CreateWikiCategoryDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) icon?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sort_order?: number;
  @ApiPropertyOptional({ format: 'uuid', description: 'Leer = globale Kategorie' }) @IsOptional() @IsUUID() working_group_id?: string | null;
}
/** Die Zuordnung zu Arbeitsgruppe oder Organisation lässt sich nicht nachträglich ändern. */
export class UpdateWikiCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) icon?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sort_order?: number;
}
