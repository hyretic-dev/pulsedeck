import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export class PushKeysDto {
  @ApiProperty() @IsString() @Matches(BASE64URL) @MaxLength(200) p256dh!: string;
  @ApiProperty() @IsString() @Matches(BASE64URL) @MaxLength(100) auth!: string;
}

export class PushSubscriptionDto {
  @ApiProperty() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(1000) endpoint!: string;
  @ApiProperty({ type: PushKeysDto }) @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

export class PushUnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(1000) endpoint!: string;
}
