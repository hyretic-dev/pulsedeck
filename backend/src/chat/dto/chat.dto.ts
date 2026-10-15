import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class ChatMessageDto {
  /** Nur Nutzer- und Assistentennachrichten: Systemanweisungen und Werkzeugergebnisse kommen nie vom Client. */
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @ApiProperty() @IsString() @MaxLength(4000) content!: string;
}

export class ChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ChatMessageDto) messages!: ChatMessageDto[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() session_id?: string;
}
