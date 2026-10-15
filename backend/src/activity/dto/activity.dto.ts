import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const GANZZAHL = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export const ONBOARDING_SCHRITTE = ['profile_complete', 'joined_ag', 'visited_wiki', 'visited_calendar', 'enable_notifications', 'added_task'] as const;

export class CreateTaskDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() done?: boolean;
}

export class TrackEventDto {
  @ApiProperty({ example: 'page_view' }) @Matches(/^[a-zA-Z0-9_.:-]{1,100}$/) event_name!: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() meta_data?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) page_path?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Wird nur übernommen, wenn der angemeldete Nutzer Mitglied ist' }) @IsOptional() @IsUUID() organization_id?: string;
}

export class SubmitFeedbackDto {
  @ApiProperty({ enum: ['bug', 'suggestion'] }) @IsIn(['bug', 'suggestion']) type!: 'bug' | 'suggestion';
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(5000) description!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Wird nur übernommen, wenn der angemeldete Nutzer Mitglied ist' }) @IsOptional() @IsUUID() organization_id?: string;
}

export class UpdateFeedbackDto {
  @ApiProperty({ enum: ['new', 'in_progress', 'done'] }) @IsIn(['new', 'in_progress', 'done']) status!: 'new' | 'in_progress' | 'done';
}

export class PresenceDto {
  @ApiProperty({ description: 'Aktueller App-Pfad (nur Pfad, keine URL)' }) @Matches(/^\/[^\s?#]{0,298}$/) current_path!: string;
}

export class PageQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(GANZZAHL) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(GANZZAHL) @IsInt() @Min(0) @Max(100000) offset?: number;
  @ApiPropertyOptional({ format: 'uuid', description: 'Nur Plattform: auf eine Organisation eingrenzen' }) @IsOptional() @IsUUID() org_id?: string;
  @ApiPropertyOptional({ description: 'Nur Audit: auf eine Tabelle eingrenzen' }) @IsOptional() @Matches(/^[a-z_]{1,64}$/) table?: string;
}
