import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EventsGateway } from './events.gateway';
import { OnboardingModule } from '../modules/onboarding/onboarding.module';
import { AiAssistantModule } from '../modules/ai-assistant/ai-assistant.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.getOrThrow<string>('jwt.expiresIn'),
        },
      }),
    }),
    forwardRef(() => OnboardingModule),
    forwardRef(() => AiAssistantModule),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
