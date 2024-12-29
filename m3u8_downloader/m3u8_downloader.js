import fs from 'fs';
import axios from 'axios';
import { spawn, execSync } from 'child_process';
import readline from 'readline';
import { SingleBar, Presets } from 'cli-progress';
import util from 'util';

// Convert exec to promise
const execPromise = util.promisify(execSync);

// Configurations
const downloadTasksFile = '.download_tasks.json';

// Utility functions
const checkDependencies = async () => {
    try {
        const ytdlpPath = execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
        console.log(`Found yt-dlp at: ${ytdlpPath}`);
    } catch (error) {
        console.error('Error: yt-dlp not found. Please install it:');
        console.error('brew install yt-dlp');
        process.exit(1);
    }
};

const fetchM3U8Links = async (url) => {
    try {
        // Extract base URL for relative path resolution
        const baseUrl = url.match(/^(https?:\/\/[^/]+)/)[1];
        const dirUrl = url.substring(0, url.lastIndexOf('/'));

        // Fetch URL content
        const curlCmd = [
            'curl',
            '--silent',
            '--max-time', '30',
            url
        ];

        const result = execSync(curlCmd.join(' '), { encoding: 'utf-8' });

        // Extract m3u8 URLs using regex
        const matches = result.match(/["']([^"' ]+\.m3u8[^"' ]*)["']/g) || [];
        
        // Process and resolve URLs
        const urls = [...new Set(matches
            .map(match => match.replace(/^["']|["']$/g, ''))  // Remove quotes
            .map(link => {
                link = link.replace(/\\/g, '');  // Remove escape chars
                if (link.startsWith('http')) {
                    return link;
                } else if (link.startsWith('/')) {
                    return `${baseUrl}${link}`;
                } else {
                    return `${dirUrl}/${link}`;
                }
            })
            .filter(link => link.includes('.m3u8'))
        )];

        if (urls.length === 0) {
            console.warn('No M3U8 URLs found in response');
        }

        return urls;
    } catch (error) {
        console.error('Failed to fetch M3U8 links:', error.message);
        return [];
    }
};

const writeTasksToFile = (tasks) => {
    fs.writeFileSync(downloadTasksFile, JSON.stringify(tasks, null, 2));
    console.log(`Tasks written to ${downloadTasksFile}`);
};

const readTasksFromFile = (taskFile = downloadTasksFile) => {
    if (fs.existsSync(taskFile)) {
        const data = fs.readFileSync(taskFile, 'utf-8');
        return JSON.parse(data);
    }
    return [];
};

// Function to convert HH:MM:SS.ms to seconds
const convertTimeToSeconds = (time) => {
    const [hours, minutes, seconds] = time.split(':').map(parseFloat);
    return hours * 3600 + minutes * 60 + seconds;
};

// Add duration fetching function
const getDuration = (url) => {
    return new Promise((resolve) => {
        const cmd = [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            url
        ];

        const ffprobe = spawn('ffprobe', cmd);
        let output = '';

        const timeout = setTimeout(() => {
            ffprobe.kill();
            console.warn(`Warning: Duration check timed out for ${url}`);
            resolve('00:00:00');
        }, 3000);

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                const duration = parseFloat(output);
                const hours = Math.floor(duration / 3600);
                const minutes = Math.floor((duration % 3600) / 60);
                const seconds = Math.floor(duration % 60);
                resolve(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
            } else {
                resolve('00:00:00');
            }
        });

        ffprobe.on('error', () => {
            clearTimeout(timeout);
            resolve('00:00:00');
        });
    });
};

// Update downloadFile function
async function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn('yt-dlp', [
            '--no-warnings',
            '-o', outputPath,
            url
        ]);

        ytdlp.stdout.pipe(process.stdout);
        ytdlp.stderr.pipe(process.stderr);

        ytdlp.on('close', (code) => {
            if (code === 0) {
                resolve(`Downloaded to ${outputPath}`);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        ytdlp.on('error', (err) => {
            reject(err);
        });
    });
}

const showHelp = () => {
    const helpText = `
M3U8 Downloader - Download M3U8 videos using yt-dlp

Usage:
    node m3u8_downloader.js [options]

Options:
    -h, --help          Show this help message
    -t, --task-file     Use existing task file (default: download_tasks.json)
    -u, --url <url>     URL to fetch M3U8 links from

Examples:
    node m3u8_downloader.js -u https://example.com/video
    node m3u8_downloader.js -t custom_tasks.json
    `;
    console.log(helpText);
    process.exit(0);
};

// Update task mapping to handle async
const createTasks = async (links) => {
    let currentDomain = '';
    let counter = 0;
    const tasks = [];

    for (const link of links) {
        const domain = new URL(link).hostname.split('.').slice(-2).join('_');
        
        if (domain !== currentDomain) {
            currentDomain = domain;
            counter = 0;
        }

        const download_file = `${domain}_${String(counter).padStart(2, '0')}.mp4`;
        const duration = await getDuration(link);
        counter++;

        tasks.push({
            key: `${link} to ${download_file} [${duration}]`,
            url: link,
            download_file: download_file
        });
    }

    return tasks;
};

// Main process
(async () => {
    const args = process.argv.slice(2);
    
    // Show help if no arguments or help flag
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        showHelp();
    }

    await checkDependencies();

    let tasks = [];
    const urlIndex = args.indexOf('-u') !== -1 ? args.indexOf('-u') : args.indexOf('--url');
    const taskIndex = args.indexOf('-t') !== -1 ? args.indexOf('-t') : args.indexOf('--task-file');

    if (urlIndex !== -1) {
        const url = args[urlIndex + 1];
        if (!url) {
            console.error('Error: URL is required with -u/--url option');
            process.exit(1);
        }
        const links = await fetchM3U8Links(url);
        tasks = await createTasks(links);
        writeTasksToFile(tasks);
    } else if (taskIndex !== -1) {
        const taskFile = args[taskIndex + 1] || downloadTasksFile;
        tasks = readTasksFromFile(taskFile);
        if (tasks.length === 0) {
            console.error('No tasks found in task file');
            process.exit(1);
        }
    } else {
        showHelp();
    }

    console.log('Task List:');
    tasks.forEach(task => console.log(task.key));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Download all items? (Y/n): ', async (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'n') {
            console.log('Exiting...');
            process.exit(0);
        }

        for (const task of tasks) {
            try {
                console.log(await downloadFile(task.url, task.download_file));
            } catch (error) {
                console.error(error);
            }
        }
    });
})();