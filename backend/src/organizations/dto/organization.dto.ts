import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsHexColor, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Musterverein e. V.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'musterverein', description: 'Wird wie im Bestand normalisiert (Umlaute, Bindestriche).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  slug!: string;

  @ApiPropertyOptional({ description: 'Anzeigename des Besitzers als Mitglied; Standard: Teil der E-Mail vor dem @.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  owner_name?: string;
}

/** Nur diese Felder darf die Organisationsverwaltung ändern; Tarif, Besitzer und Slug nicht. */
export class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsHexColor() primary_color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) logo_url?: string | null;
}

export class OrganizationDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) logo_url!: string | null;
  @ApiProperty() primary_color!: string;
  @ApiProperty({ enum: ['free', 'pro', 'pro_bono'] }) subscription_tier!: string;
  @ApiProperty() max_members!: number;
  @ApiProperty() branding_enabled!: boolean;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}

export class SlugAvailabilityDto {
  @ApiProperty() available!: boolean;
}
