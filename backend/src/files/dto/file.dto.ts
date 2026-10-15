import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const DATEI_SICHTBARKEITEN = ['public', 'member', 'committee', 'admin', 'ag-only'] as const;
const WAHR = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class FileListQuery {
  @ApiPropertyOptional({ description: 'Ordner-ID oder `root` für die oberste Ebene' }) @IsOptional() @Matches(/^(root|[0-9a-f-]{36})$/i) folder_id?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(WAHR) @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string;
  @ApiPropertyOptional({ description: 'Suche im Dateinamen' }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['name', 'recent'] }) @IsOptional() @IsIn(['name', 'recent']) sort?: 'name' | 'recent';
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : Number(value))) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class UploadFileDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() folder_id?: string;
  @ApiPropertyOptional({ enum: DATEI_SICHTBARKEITEN }) @IsOptional() @IsIn(DATEI_SICHTBARKEITEN) visibility?: (typeof DATEI_SICHTBARKEITEN)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string;
}

export class UpdateFileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ enum: DATEI_SICHTBARKEITEN }) @IsOptional() @IsIn(DATEI_SICHTBARKEITEN) visibility?: (typeof DATEI_SICHTBARKEITEN)[number];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() working_group_id?: string | null;
  @ApiPropertyOptional({ format: 'uuid', description: 'null = oberste Ebene' }) @IsOptional() @IsUUID() folder_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_pinned?: boolean;
}

export class CreateFolderDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() parent_id?: string | null;
}

export class RenameFolderDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
}

export class FolderListQuery {
  @ApiPropertyOptional({ description: 'Eltern-Ordner oder `root`' }) @IsOptional() @Matches(/^(root|[0-9a-f-]{36})$/i) parent_id?: string;
}
