import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsHexColor, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

import { HERKUNFTSQUELLEN } from '../organization-defaults';

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

  @ApiPropertyOptional({ enum: HERKUNFTSQUELLEN, description: 'Wie die Organisation auf PulseDeck aufmerksam wurde (nur intern, wird nie ausgeliefert).' })
  @IsOptional()
  @IsIn(HERKUNFTSQUELLEN)
  acquisition_source?: string;

  @ApiPropertyOptional({ example: 'kv-nord', description: 'Kennung aus dem Werbelink (?ref=), nur Kleinbuchstaben, Ziffern, - und _.' })
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  acquisition_ref?: string;

  @ApiPropertyOptional({ description: 'Die Organisation möchte Pilot werden und PulseDeck gemeinsam einrichten.' })
  @IsOptional()
  @IsBoolean()
  pilot_requested?: boolean;

  @ApiPropertyOptional({ description: 'Wunschzeitraum für das Einrichtungsgespräch.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  pilot_wish?: string;
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
