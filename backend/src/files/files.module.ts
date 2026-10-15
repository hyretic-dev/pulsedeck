import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { OBJECT_STORAGE, FilesystemObjectStorage } from '../storage/object-storage';
import { TenancyModule } from '../tenancy/tenancy.module';

import { FileDownloadController } from './file-download.controller';
import { FileLinks } from './file-links';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [
    TenancyModule,
    // Obergrenze je Upload aus der Konfiguration; ohne `storage`/`dest` hält multer die Datei im Speicher.
    MulterModule.registerAsync({
      useFactory: (config: AppConfig) => ({ limits: { fileSize: config.storage.maxUploadBytes, files: 1, fields: 10, fieldSize: 8 * 1024 } }),
      inject: [APP_CONFIG],
    }),
  ],
  controllers: [FilesController, FileDownloadController],
  providers: [
    { provide: OBJECT_STORAGE, useFactory: (config: AppConfig) => new FilesystemObjectStorage(config.storage.dir), inject: [APP_CONFIG] },
    FilesService,
    FileLinks,
  ],
  exports: [FilesService, OBJECT_STORAGE],
})
export class FilesModule {}
