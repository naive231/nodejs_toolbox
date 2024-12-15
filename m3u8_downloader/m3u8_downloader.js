const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const HlsDownload = require('node-m3u8-downloader');
const prompts = require('prompts');

const DOWNLOAD_TASKS_FILE = '.download_tasks.json';

// Configure ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Fetch .m3u8 links from the given URL
async function fetchM3U8Links(url) {
    try {
        const response = await axios.get(url);
        const content = response.data;

        const baseUrl = new URL(url).origin;
        const links = [...content.matchAll(/["']([^"']+\.m3u8[^"']*)["']/g)].map(match => match[1]);

        return [...new Set(links.map(link => (link.startsWith('http') ? link : `${baseUrl}${link}`)))];
    } catch (error) {
        console.error('Error fetching .m3u8 links:', error.message);
        process.exit(1);
    }
}

// Rename and ensure unique filenames
function renameAndAppend(links) {
    return links.map((link, i) => {
        const fileName = path.basename(link).split('?')[0];
        const uniqueName = `${fileName.replace(/\..*$/, '')}_${i + 1}.mp4`;
        return { url: link, name: uniqueName };
    });
}

// Fetch video durations using fluent-ffmpeg
async function appendDuration(renamedLinks) {
    const linksWithDuration = [];

    for (const link of renamedLinks) {
        try {
            const duration = await new Promise((resolve, reject) => {
                ffmpeg(link.url)
                    .ffprobe((err, data) => {
                        if (err) return reject(err);

                        const durationInSeconds = Math.floor(data.format.duration || 0);
                        resolve(durationInSeconds);
                    });
            });

            const hours = String(Math.floor(duration / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((duration % 3600) / 60)).padStart(2, '0');
            const seconds = String(duration % 60).padStart(2, '0');
            linksWithDuration.push({ ...link, duration: `${hours}:${minutes}:${seconds}` });
        } catch (error) {
            linksWithDuration.push({ ...link, duration: '00:00:00' });
        }
    }

    return linksWithDuration.filter(link => link.duration !== '00:00:00');
}

// Write tasks to JSON file
function writeToJson(tasks) {
    fs.writeFileSync(DOWNLOAD_TASKS_FILE, JSON.stringify(tasks, null, 2));
    console.log(`Written tasks to ${DOWNLOAD_TASKS_FILE}`);
}

// Read existing tasks from JSON file
function readTasks() {
    if (!fs.existsSync(DOWNLOAD_TASKS_FILE)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(DOWNLOAD_TASKS_FILE));
}

// Download using node-m3u8-downloader
async function handleDownloads(tasks) {
    const downloader = new HlsDownload();
    console.log('Starting downloads...');

    for (const task of tasks) {
        console.log(`Downloading '${task.name}' from ${task.url}...`);
        await downloader
            .start(task.url, { output: task.name })
            .then(() => console.log(`Downloaded '${task.name}' successfully.`))
            .catch(err => console.error(`Failed to download '${task.name}':`, err.message));
    }
}

// Main function
(async function main() {
    // Handle existing tasks
    let tasks = readTasks();

    if (tasks.length > 0) {
        const { useExisting } = await prompts({
            type: 'confirm',
            name: 'useExisting',
            message: 'Existing task file found. Use it?',
            initial: true
        });

        if (!useExisting) tasks = [];
    }

    // If no existing tasks, fetch new links
    if (tasks.length === 0) {
        const { url } = await prompts({
            type: 'text',
            name: 'url',
            message: 'Enter the URL containing .m3u8 links:'
        });

        const links = await fetchM3U8Links(url);
        const renamedLinks = renameAndAppend(links);
        const linksWithDuration = await appendDuration(renamedLinks);

        writeToJson(linksWithDuration);
        tasks = linksWithDuration;
    }

    // Confirm and download
    const { confirmDownload } = await prompts({
        type: 'confirm',
        name: 'confirmDownload',
        message: 'Download all listed items?',
        initial: true
    });

    if (confirmDownload) {
        await handleDownloads(tasks);
    } else {
        console.log('Exiting without downloading.');
    }
})();

