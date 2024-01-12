"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const puppeteer_1 = __importDefault(require("puppeteer"));
const puppeteer_screen_recorder_1 = require("puppeteer-screen-recorder");
const dayjs_1 = __importDefault(require("dayjs"));
const nb_1 = __importDefault(require("dayjs/locale/nb"));
const telegraf_1 = require("telegraf");
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const fs_1 = __importDefault(require("fs"));
const node_cron_1 = __importDefault(require("node-cron"));
dayjs_1.default.locale(Object.assign({}, nb_1.default)); // use Norwegian locale globally
const { AUTORINGEN_EMAIL, AUTORINGEN_PASSWORD } = process.env;
const main = async () => {
    if (process.env.NODE_ENV === 'production') {
        node_cron_1.default.schedule('0 11 * * *', simulateBrowserRecording);
        node_cron_1.default.schedule('0 14 * * *', simulateBrowserRecording);
    }
    else {
        simulateBrowserRecording();
    }
};
const simulateBrowserRecording = async () => {
    const screenRecorderConfig = {
        followNewTab: true,
        fps: 25,
        videoFrame: {
            width: 1920,
            height: 1080,
        },
        ffmpeg_Path: null,
        videoCrf: 18,
        videoCodec: 'libx264',
        videoPreset: 'ultrafast',
        videoBitrate: 1000,
        autopad: {
            color: '#35A5FF',
        },
        aspectRatio: '16:9',
    };
    try {
        const browser = await puppeteer_1.default.launch({
            headless: true,
            defaultViewport: null,
            args: ['--disable-features=site-per-process', '--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({
            width: 1300,
            height: 1000,
            deviceScaleFactor: 1,
        });
        await page.goto('https://autoringen.no/login');
        /** If appears a modal with div class="cm-modal", press button with class="cm-btn cm-btn-success cm-btn-accept-all" */
        const modal = await page.$('.cm-modal');
        if (modal) {
            await page.click('.cm-btn.cm-btn-success.cm-btn-accept-all');
        }
        /** Fill the input id="email" with "AUTORINGEN_EMAIL" */
        await page.type('#email', AUTORINGEN_EMAIL);
        /** Fill the input id="password" with "AUTORINGEN_PASSWORD" */
        await page.type('#password', AUTORINGEN_PASSWORD);
        /** Click on submit button */
        await page.evaluate(() => {
            const submitButton = document.querySelector('button[type="submit"]');
            submitButton === null || submitButton === void 0 ? void 0 : submitButton.click();
        });
        /** Wait for 3 sec (with promise) */
        await new Promise((resolve) => setTimeout(resolve, 3000));
        /** Click on div class="p-3 h-100 bg-white bg-card-shadow border-radius-10" with role="button" */
        await page.evaluate(() => {
            const card = document.querySelector('.custom-card');
            card === null || card === void 0 ? void 0 : card.click();
        });
        /** Start recording the page */
        const recorder = new puppeteer_screen_recorder_1.PuppeteerScreenRecorder(page, screenRecorderConfig);
        const currentTime = (0, dayjs_1.default)().format('YYYY-MM-DD-HH-mm');
        const savePath = `./videos/${currentTime}.mp4`;
        await recorder.start(savePath);
        console.info('-- Recording started --');
        /** Record for 1 minutes */
        const duration = 60000 / 15;
        await new Promise((resolve) => setTimeout(resolve, duration));
        await recorder.stop();
        console.info('-- Recording stopped --');
        await browser.close();
        const { location } = await saveVideoToS3(savePath);
        await sendVideoToTelegramBot(location);
    }
    catch (error) {
        console.error(error);
    }
};
const saveVideoToS3 = async (filePath) => {
    /**
     * Save video to s3 bucket
     */
    try {
        const s3 = new aws_sdk_1.default.S3({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });
        const fileContent = fs_1.default.readFileSync(filePath);
        const params = {
            Bucket: 'autoringen-fetcher-v2',
            Key: 'screen-recordings/video.mp4',
            Body: fileContent,
            ContentType: 'video/mp4',
        };
        const uploadResult = await s3.upload(params).promise();
        console.info('File uploaded successfully');
        /** Delete from local storage */
        fs_1.default.unlinkSync(filePath);
        return { location: uploadResult.Location };
    }
    catch (error) {
        console.error(error);
    }
};
const sendVideoToTelegramBot = async (s3VideoUrl) => {
    /**
     * Send video to telegram bot
     */
    try {
        const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        await bot.telegram.sendMessage(6450576633, `New recording available at: ${s3VideoUrl}`);
        console.info('Video sent to telegram bot');
    }
    catch (error) {
        console.error(error);
    }
};
main();
//# sourceMappingURL=index.js.map