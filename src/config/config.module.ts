import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { appConfig, authConfig, dbConfig, mailConfig, rabbitConfig } from './config.js'
import { envSchema } from './env.js'

/**
 * Global, validated configuration: the Zod schema runs at startup and the
 * process stops on any invalid variable. Inject a group with
 * `@Inject(mailConfig.KEY) config: ConfigType<typeof mailConfig>`.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            cache: true,
            // main.ts / node --env-file load .env; the module never reads files.
            ignoreEnvFile: true,
            validationSchema: envSchema,
            load: [
                appConfig,
                dbConfig,
                rabbitConfig,
                authConfig,
                mailConfig,
            ],
        }),
    ],
})
export class AppConfigModule {}
