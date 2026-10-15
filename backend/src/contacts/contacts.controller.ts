import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard, RequirePermission } from '../tenancy/require-permission';
import { CurrentUserId } from '../tenancy/request-context';

import { ContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@ApiTags('contacts')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/contacts')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class ContactsController {
  constructor(private readonly kontakte: ContactsService) {}

  @Get()
  liste(@Param('orgId') orgId: string) {
    return this.kontakte.liste(orgId);
  }

  @Post()
  @RequirePermission('contacts:edit')
  anlegen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: CreateContactDto) {
    return this.kontakte.anlegen(userId, orgId, { ...dto });
  }

  @Patch(':contactId')
  @RequirePermission('contacts:edit')
  aendern(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('contactId', ParseUUIDPipe) contactId: string, @Body() dto: UpdateContactDto) {
    return this.kontakte.aendern(userId, orgId, contactId, { ...dto });
  }

  @Delete(':contactId')
  @HttpCode(204)
  @RequirePermission('contacts:edit')
  async loeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('contactId', ParseUUIDPipe) contactId: string): Promise<void> {
    await this.kontakte.loeschen(userId, orgId, contactId);
  }
}
