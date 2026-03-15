import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

interface TokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const slug = this.generateSlug(dto.tenantName);

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      throw new ConflictException(
        'A tenant with a similar name already exists. Please choose a different name.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.tenantName,
        slug,
        users: {
          create: {
            email: dto.email.toLowerCase().trim(),
            passwordHash,
            fullName: dto.fullName,
            role: 'owner',
          },
        },
      },
      include: {
        users: true,
      },
    });

    const user = tenant.users[0];

    this.logger.log(
      `New tenant registered: ${tenant.name} (${tenant.id}) by ${user.email}`,
    );

    return this.buildAuthResponse(user, tenant.id);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.validateUser(dto.email, dto.password);

    this.logger.log(`User logged in: ${user.email} (tenant: ${user.tenantId})`);

    return this.buildAuthResponse(user, user.tenantId);
  }

  async refreshToken(token: string): Promise<AuthResponse> {
    try {
      const payload = this.jwtService.verify<TokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      });

      const user = await this.prisma.user.findFirst({
        where: {
          id: payload.sub,
          tenantId: payload.tenantId,
        },
      });

      if (!user) {
        throw new UnauthorizedException('User no longer exists');
      }

      return this.buildAuthResponse(user, user.tenantId);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<{
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
  }> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
    };
  }

  private buildAuthResponse(
    user: { id: string; email: string; fullName: string; role: string; tenantId?: string },
    tenantId: string,
  ): AuthResponse {
    const payload: TokenPayload = {
      sub: user.id,
      tenantId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: this.configService.getOrThrow<string>('jwt.refreshExpiresIn'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId,
      },
    };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
