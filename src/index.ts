require('dotenv').config()
import axios from 'axios'
import puppeteer from 'puppeteer'
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder'
import dayjs from 'dayjs'
import nb from 'dayjs/locale/nb'
import { Telegraf } from 'telegraf'
import AWS from 'aws-sdk'
import fs from 'fs'
import cron from 'node-cron'

dayjs.locale({ ...nb }) // use Norwegian locale globally

const { AUTORINGEN_EMAIL, AUTORINGEN_PASSWORD } = process.env

const main = async () => {
    if (process.env.NODE_ENV === 'production') {
        cron.schedule('0 11 * * *', simulateBrowserRecording)
        cron.schedule('0 14 * * *', simulateBrowserRecording)
    } else {
        simulateBrowserRecording()
    }
}

const simulateBrowserRecording = async () => {
    const screenRecorderConfig = {
        followNewTab: true,
        fps: 25,
        videoFrame: {
            width: 1920,
            height: 1080,
        },
        ffmpeg_Path: null as string | null,
        videoCrf: 18,
        videoCodec: 'libx264',
        videoPreset: 'ultrafast',
        videoBitrate: 1000,
        autopad: {
            color: '#35A5FF',
        },
        aspectRatio: '16:9',
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null,
            args: ['--disable-features=site-per-process', '--no-sandbox', '--disable-setuid-sandbox'],
        })
        const page = await browser.newPage()
        await page.setViewport({
            width: 1300,
            height: 1000,
            deviceScaleFactor: 1,
        })

        await page.goto('https://autoringen.no/login')

        /** If appears a modal with div class="cm-modal", press button with class="cm-btn cm-btn-success cm-btn-accept-all" */
        const modal = await page.$('.cm-modal')
        if (modal) {
            await page.click('.cm-btn.cm-btn-success.cm-btn-accept-all')
        }

        /** Fill the input id="email" with "AUTORINGEN_EMAIL" */
        await page.type('#email', AUTORINGEN_EMAIL)

        /** Fill the input id="password" with "AUTORINGEN_PASSWORD" */
        await page.type('#password', AUTORINGEN_PASSWORD)

        /** Click on submit button */
        await page.evaluate(() => {
            const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement
            submitButton?.click()
        })

        /** Wait for 3 sec (with promise) */
        await new Promise((resolve) => setTimeout(resolve, 3000))

        /** Click on div class="p-3 h-100 bg-white bg-card-shadow border-radius-10" with role="button" */
        await page.evaluate(() => {
            const card = document.querySelector('.custom-card') as HTMLDivElement

            card?.click()
        })

        /** Start recording the page */
        const recorder = new PuppeteerScreenRecorder(page, screenRecorderConfig)

        const currentTime = dayjs().format('YYYY-MM-DD-HH-mm')
        const savePath = `./videos/${currentTime}.mp4`

        await recorder.start(savePath)
        console.info('-- Recording started --')

        /** Record for 1 minutes */
        const duration = 60000 / 15
        await new Promise((resolve) => setTimeout(resolve, duration))

        await recorder.stop()
        console.info('-- Recording stopped --')

        await browser.close()

        const { location } = await saveVideoToS3(savePath)

        await sendVideoToTelegramBot(location)
    } catch (error) {
        console.error(error)
    }
}

const saveVideoToS3 = async (filePath: string): Promise<{ location: string }> => {
    /**
     * Save video to s3 bucket
     */

    try {
        const s3 = new AWS.S3({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        })

        const fileContent = fs.readFileSync(filePath)

        const params = {
            Bucket: 'autoringen-fetcher-v2',
            Key: 'screen-recordings/video.mp4',
            Body: fileContent,
            ContentType: 'video/mp4',
        }

        const uploadResult = await s3.upload(params).promise()

        console.info('File uploaded successfully')

        /** Delete from local storage */
        fs.unlinkSync(filePath)

        return { location: uploadResult.Location }
    } catch (error) {
        console.error(error)
    }
}

const sendVideoToTelegramBot = async (s3VideoUrl: string) => {
    /**
     * Send video to telegram bot
     */

    try {
        const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string)

        await bot.telegram.sendMessage(6450576633, `New recording available at: ${s3VideoUrl}`)

        console.info('Video sent to telegram bot')
    } catch (error) {
        console.error(error)
    }
}

main()
