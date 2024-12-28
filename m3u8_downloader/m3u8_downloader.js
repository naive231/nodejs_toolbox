import fs from 'fs';
import axios from 'axios';
import { spawn, execSync } from 'child_process';
import readline from 'readline';
import { SingleBar, Presets } from 'cli-progress';
import util from 'util';

// Convert exec to promise
const execPromise = util.promisify(execSync);

// Configurations
const downloadTasksFile = './download_tasks.json';

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
        const response = await axios.get(url);
        const matches = [...response.data.matchAll(/https?:\/\/[^\s"']+\.m3u8/g)];
        return matches.map(match => match[0]);
    } catch (error) {
        console.error('Failed to fetch M3U8 links:', error.message);
        return [];
    }
};

const writeTasksToFile = (tasks) => {
    fs.writeFileSync(downloadTasksFile, JSON.stringify(tasks, null, 2));
    console.log(`Tasks written to ${downloadTasksFile}`);
};

const readTasksFromFile = () => {
    if (fs.existsSync(downloadTasksFile)) {
        const data = fs.readFileSync(downloadTasksFile, 'utf-8');
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

// Main process
(async () => {
    await checkDependencies();

    let tasks = readTasksFromFile();
    if (tasks.length === 0) {
        console.log('No tasks found. Fetching new tasks...');
        const url = process.argv[2];
        if (!url) {
            console.error('Usage: node m3u8_downloader.js <URL>');
            process.exit(1);
        }
        const links = await fetchM3U8Links(url);
        tasks = links.map((link, index) => ({
            key: `${link} to output_${index}.mp4`,
            url: link,
            download_file: `output_${index}.mp4`
        }));
        writeTasksToFile(tasks);
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