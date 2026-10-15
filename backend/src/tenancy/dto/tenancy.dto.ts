import { ApiProperty } from '@nestjs/swagger';

export class MembershipSummaryDto {
  @ApiProperty() member_id!: string;
  @ApiProperty() member_name!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() organization_name!: string;
  @ApiProperty() organization_slug!: string;
  @ApiProperty({ enum: ['public', 'member', 'committee', 'admin'] }) app_role!: string;
}

export class OrgRoleDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty() is_system_admin!: boolean;
  @ApiProperty() is_default!: boolean;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}

export class MemberAccessDto {
  @ApiProperty({ description: 'Das Konto ist Besitzer der Organisation.' }) isOwner!: boolean;
  @ApiProperty({ description: 'Besitzer, System-Admin-Rolle oder app_role admin.' }) isAdmin!: boolean;
  @ApiProperty({ type: [String], description: 'Serverseitig aufgelöste Berechtigungsschlüssel (Anzeige, keine Berechtigung).' })
  permissions!: string[];
}

export class MemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() user_id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) role!: string | null;
  @ApiProperty({ type: String, nullable: true }) department!: string | null;
  @ApiProperty({ enum: ['Active', 'Inactive', 'Pending'] }) status!: string;
  @ApiProperty() email!: string;
  @ApiProperty() join_date!: string;
  @ApiProperty({ type: String, nullable: true }) avatar_url!: string | null;
  @ApiProperty({ enum: ['public', 'member', 'committee', 'admin'] }) app_role!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty() role_id!: string;
  @ApiProperty({ type: String, nullable: true }) street!: string | null;
  @ApiProperty({ type: String, nullable: true }) zip_code!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) birthday!: string | null;
  @ApiProperty({ type: String, nullable: true }) custom_info!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) contact_channels!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true, description: 'Eigenes Kalender-Token (Zugangsdatum, nie loggen).' })
  calendar_token!: string | null;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
  @ApiProperty({ type: OrgRoleDto, description: 'Rolle der Organisation (Join auf organization_roles).' }) org_role!: OrgRoleDto;
  @ApiProperty({ type: MemberAccessDto }) access!: MemberAccessDto;
}
