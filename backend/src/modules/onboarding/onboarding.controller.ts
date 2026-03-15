import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { OnboardingService } from './onboarding.service';

class SwipeDto {
  matchCandidateId!: string;
  action!: 'accept' | 'reject' | 'skip';
}

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a new onboarding / smart-match session' })
  async start(@CurrentTenant() tenantId: string) {
    const session = await this.onboarding.startSession(tenantId);
    return { session };
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get onboarding session status and progress' })
  async getSession(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.onboarding.getSession(tenantId, sessionId);
  }

  @Get(':sessionId/next-match')
  @ApiOperation({
    summary: 'Get the next match candidate pair for swiping',
  })
  async getNextMatch(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.onboarding.getNextMatch(tenantId, sessionId);
  }

  @Post(':sessionId/swipe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle a swipe action on a match candidate' })
  async swipe(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SwipeDto,
  ) {
    return this.onboarding.handleSwipe(
      tenantId,
      sessionId,
      dto.matchCandidateId,
      dto.action,
    );
  }

  @Post(':sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize the onboarding session' })
  async complete(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.onboarding.completeSession(tenantId, sessionId);
  }

  @Get(':sessionId/summary')
  @ApiOperation({ summary: 'Get onboarding session results summary' })
  async summary(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.onboarding.getSessionSummary(tenantId, sessionId);
  }
}
