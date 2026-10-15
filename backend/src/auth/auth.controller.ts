import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  LOGIN_RATE_LIMITER,
  MAIL_RATE_LIMITER,
  MIN_RESPONSE_MS,
} from './auth.tokens';
import type { RateLimiter } from './rate-limiter';
import {
  AccountDto,
  ChangePasswordDto,
  CheckEmailDto,
  CheckEmailResponseDto,
  EmailRequestDto,
  LoginDto,
  LogoutDto,
  MagicLinkConsumeDto,
  PasswordResetConsumeDto,
  RefreshDto,
  SetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';

type ApiRequest = Request & { userId?: string };

/** Endpunkte sind rein Bearer-basiert (O2): kein Cookie, kein CSRF-Transport. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(LOGIN_RATE_LIMITER) private readonly loginLimiter: RateLimiter,
    @Inject(MAIL_RATE_LIMITER) private readonly mailLimiter: RateLimiter,
    @Inject(MIN_RESPONSE_MS) private readonly minResponseMs: number
  ) {}

  /**
   * Hält die Antwort mindestens `minResponseMs` zurück. Signup, Magic-Link und Reset leisten
   * nur für bekannte (bzw. neue) Konten zusätzliche Arbeit (DB-Schreibzugriffe); ohne diese
   * Untergrenze verriete die Antwortzeit, ob ein Konto existiert.
   */
  private async mitMindestdauer<T>(arbeit: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await arbeit();
    } finally {
      const rest = this.minResponseMs - (performance.now() - start);
      if (rest > 0) await new Promise((fertig) => setTimeout(fertig, rest));
    }
  }

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async login(@Req() request: ApiRequest, @Body() dto: LoginDto): Promise<AuthSessionResponseDto> {
    // Rate-Limit vor jeder Prüfung: gleiche Antwort für bekannte und unbekannte E-Mails.
    const limit = await this.loginLimiter.consume(`login:${dto.email}:${request.ip ?? ''}`);
    if (!limit.allowed) {
      throw new HttpException(
        { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    const sitzung = await this.auth.loginWithPassword(dto.email, dto.password);
    return sitzung;
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async refresh(@Body() dto: RefreshDto): Promise<AuthSessionResponseDto> {
    // Separater Endpunkt: Authentifizierung nur über den Refresh-Token im Body.
    return this.auth.refreshSession(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.revokeSession(dto.refreshToken);
  }

  @Post('signup')
  @HttpCode(202)
  async signup(@Req() request: ApiRequest, @Body() dto: SignupDto): Promise<void> {
    await this.mitMindestdauer(async () => {
      const limit = await this.mailLimiter.consume(`signup:${dto.email}:${request.ip ?? ''}`);
      if (!limit.allowed) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      await this.auth.signUp(dto.email, dto.password);
    });
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthSessionResponseDto> {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('magic-link')
  @HttpCode(202)
  async requestMagicLink(@Req() request: ApiRequest, @Body() dto: EmailRequestDto): Promise<void> {
    await this.mitMindestdauer(async () => {
      const limit = await this.mailLimiter.consume(`magic-link:${dto.email}:${request.ip ?? ''}`);
      if (!limit.allowed) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      await this.auth.requestMagicLink(dto.email);
    });
  }

  @Post('magic-link/consume')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async consumeMagicLink(@Body() dto: MagicLinkConsumeDto): Promise<AuthSessionResponseDto> {
    return this.auth.consumeMagicLink(dto.token);
  }

  @Post('password-reset')
  @HttpCode(202)
  async requestPasswordReset(@Req() request: ApiRequest, @Body() dto: EmailRequestDto): Promise<void> {
    await this.mitMindestdauer(async () => {
      const limit = await this.mailLimiter.consume(`password-reset:${dto.email}:${request.ip ?? ''}`);
      if (!limit.allowed) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      await this.auth.requestPasswordReset(dto.email);
    });
  }

  @Post('password-reset/consume')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async resetPassword(@Body() dto: PasswordResetConsumeDto): Promise<AuthSessionResponseDto> {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  /**
   * E-Mail-Prüfung der Login-Seite (Ersatz von send-invitation). Begrenzt wie der Login (je E-Mail+IP),
   * mit Mindestdauer; die Antwort nennt nur den Status, keine Namen oder Organisationen.
   */
  @Post('check-email')
  @HttpCode(200)
  @ApiOkResponse({ type: CheckEmailResponseDto })
  async checkEmail(@Req() request: ApiRequest, @Body() dto: CheckEmailDto): Promise<CheckEmailResponseDto> {
    return this.mitMindestdauer(async () => {
      const limit = await this.loginLimiter.consume(`check-email:${dto.email}:${request.ip ?? ''}`);
      if (!limit.allowed) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      return this.auth.checkEmail(dto.email, dto.organization_id);
    });
  }

  /** Das eigene Konto (Profilseite: ist ein Passwort gesetzt?). */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: AccountDto })
  ich(@Req() request: ApiRequest): Promise<AccountDto> {
    return this.auth.ichSelbst(request.userId as string);
  }

  /** Erstes Passwort für ein eingeladenes Konto ohne Passwort (sonst `change-password`). */
  @Post('set-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  setPassword(@Req() request: ApiRequest, @Body() dto: SetPasswordDto): Promise<AuthSessionResponseDto> {
    return this.auth.setzeErstesPasswort(request.userId as string, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async changePassword(
    @Req() request: ApiRequest,
    @Body() dto: ChangePasswordDto
  ): Promise<AuthSessionResponseDto> {
    // Identität ausschließlich aus dem verifizierten JWT (Guard), nie aus Body-Feldern.
    const userId = request.userId;
    if (!userId) {
      throw new UnauthorizedException('Nicht authentifiziert');
    }
    return this.auth.changePassword(userId, dto.oldPassword, dto.newPassword);
  }
}

