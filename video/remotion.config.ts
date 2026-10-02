import { Config } from '@remotion/cli/config';

// Кадры в PNG: без потерь до кодирования, тонкий текст интерфейса остаётся чётким.
Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
