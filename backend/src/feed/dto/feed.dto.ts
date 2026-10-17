import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const FEED_ARTEN = ['article', 'link', 'poll'] as const;
/** Über die API setzbare Stati; `sent` setzt ausschließlich der Newsletter-Versand. */
export const FEED_STATI = ['draft', 'review', 'approved'] as const;

const URL_OPTIONEN = { protocols: ['http', 'https'], require_protocol: true };

export class PollConfigDto {
  @ApiProperty() @IsBoolean() multiple_choice!: boolean;
  @ApiPropertyOptional({ description: 'Ende der Abstimmung (ISO 8601)' }) @IsOptional() @IsISO8601() end_date?: string;
}

export class CreateFeedItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100000) content?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTIONEN) @MaxLength(2000) url?: string | null;
  @ApiProperty({ enum: FEED_ARTEN }) @IsIn(FEED_ARTEN) type!: (typeof FEED_ARTEN)[number];
  @ApiPropertyOptional({ enum: FEED_STATI }) @IsOptional() @IsIn(FEED_STATI) status?: (typeof FEED_STATI)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_public?: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string | null;
  @ApiPropertyOptional({ type: PollConfigDto }) @IsOptional() @ValidateNested() @Type(() => PollConfigDto) poll_config?: PollConfigDto;
  @ApiPropertyOptional({ type: [String], description: 'Antwortmöglichkeiten einer Umfrage (2-20)' })
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(20) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(200, { each: true }) options?: string[];
}

/** Art und Umfrageoptionen lassen sich nachträglich nicht ändern. */
export class UpdateFeedItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100000) content?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTIONEN) @MaxLength(2000) url?: string | null;
  @ApiPropertyOptional({ enum: FEED_STATI }) @IsOptional() @IsIn(FEED_STATI) status?: (typeof FEED_STATI)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_public?: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string | null;
  @ApiPropertyOptional({ type: PollConfigDto }) @IsOptional() @ValidateNested() @Type(() => PollConfigDto) poll_config?: PollConfigDto;
}

export class PinDto {
  @ApiProperty() @IsBoolean() is_pinned!: boolean;
}
