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
        // Check if ffmpeg exists
        const ffmpegPath = execSync('which ffmpeg').toString().trim();
        console.log('ffmpeg is installed at:', ffmpegPath);
        
        // Verify ffmpeg works
        execSync('ffmpeg -version');
        return true;
    } catch (error) {
        console.error('Error: ffmpeg is not installed or not in PATH.');
        console.error('Detailed error:', error.message);
        process.exit(1);
    }
};

// Add ffmpeg check with detailed error reporting
try {
    const ffmpegPath = execSync('which ffmpeg').toString().trim();
    console.log(`Found ffmpeg at: ${ffmpegPath}`);
} catch (error) {
    console.error('Error: ffmpeg check failed:', error);
    process.exit(1);
}

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


// Update downloadFile function
async function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const filename = outputPath.split('/').pop(); // Extract filename
        const progressBar = new SingleBar({
            format: `${filename} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Speed: {speed}`,
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
            clearOnComplete: true
        }, Presets.shades_classic);

        const ffmpeg = spawn('ffmpeg', [
            '-i', url,
            '-c', 'copy',
            outputPath,
            '-progress', 'pipe:1'
        ]);

        let duration = 0;
        let started = false;

        ffmpeg.stderr.on('data', (data) => {
            const output = data.toString();
            if (!started && output.includes('Duration')) {
                const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
                if (match) {
                    duration = (parseInt(match[1]) * 3600) + 
                              (parseInt(match[2]) * 60) + 
                              parseInt(match[3]);
                    progressBar.start(duration, 0);
                    started = true;
                }
            }
        });

        ffmpeg.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('out_time_ms')) {
                const time = parseInt(output.match(/out_time_ms=(\d+)/)[1]) / 1000000;
                progressBar.update(time);
            }
        });

        ffmpeg.on('close', (code) => {
            progressBar.stop();
            if (code === 0) {
                resolve(`Successfully downloaded to ${outputPath}`);
            } else {
                reject(new Error(`FFmpeg process exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            progressBar.stop();
            reject(err);
        });
    });
}

const showHelp = () => {
    const helpText = `
M3U8 Downloader - Download M3U8 videos

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

        // Track domains and counters
        let currentDomain = '';
        let counter = 0;

        tasks = links.map((link) => {
            // Extract domain from URL
            const domain = new URL(link).hostname.split('.').slice(-2).join('_');
            
            // Reset counter if domain changes
            if (domain !== currentDomain) {
                currentDomain = domain;
                counter = 0;
            }

            const download_file = `${domain}_${String(counter).padStart(2, '0')}.mp4`;
            counter++;

            return {
                key: `${link} to ${download_file}`,
                url: link,
                download_file: download_file
            };
        });
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