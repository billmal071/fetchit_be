import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, AuthResponseDto, TokensDto } from './dto';
import { CreateUserDto } from '@/modules/users/dto';
import { JwtRefreshGuard } from './guards';
import { Public, CurrentUser } from '@/common/decorators';
import {
  ApiSuccessResponse,
  ApiCreatedSuccessResponse,
  ApiErrorResponses,
} from '@/common/decorators';
import { SUCCESS_MESSAGES } from '@/common/constants';
import { IRequestUser } from '@/common/interfaces';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiCreatedSuccessResponse(AuthResponseDto)
  @ApiErrorResponses()
  async register(@Body() createUserDto: CreateUserDto): Promise<{
    data: AuthResponseDto;
    message: string;
  }> {
    const result = await this.authService.register(createUserDto);
    return { data: result, message: SUCCESS_MESSAGES.USER_CREATED };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiSuccessResponse(AuthResponseDto)
  @ApiErrorResponses()
  async login(@Body() loginDto: LoginDto): Promise<{
    data: AuthResponseDto;
    message: string;
  }> {
    const result = await this.authService.login(loginDto);
    return { data: result, message: SUCCESS_MESSAGES.LOGIN_SUCCESS };
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout current user' })
  @ApiErrorResponses()
  async logout(@CurrentUser() user: IRequestUser): Promise<{ message: string }> {
    await this.authService.logout(user.id);
    return { message: SUCCESS_MESSAGES.LOGOUT_SUCCESS };
  }

  @Post('refresh')
  @Public()
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiSuccessResponse(TokensDto)
  @ApiErrorResponses()
  async refreshTokens(
    @Body() refreshTokenDto: RefreshTokenDto,
    @CurrentUser() user: { id: string; refreshToken: string },
  ): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    const tokens = await this.authService.refreshTokens(user.id, user.refreshToken);
    return { data: tokens };
  }
}
