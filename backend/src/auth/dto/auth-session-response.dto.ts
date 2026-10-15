import { ApiProperty } from '@nestjs/swagger';

export class AuthSessionResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  userId!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiJ9…' })
  accessToken!: string;

  @ApiProperty({ example: 'a3F…' })
  refreshToken!: string;
}
