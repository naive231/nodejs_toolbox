import fs from 'fs';
import axios from 'axios';
import { exec } from 'child_process';
import readline from 'readline';
import { promisify } from 'util';

// Promisify exec for async/await
const execPromise = promisify(exec);

// Configurations
const downloadTasksFile = './download_tasks.json';

// Utility functions
const checkDependencies = async () => {
    try {
        await execPromise('which ffmpeg');
        console.log('ffmpeg is installed.');
    } catch {
        console.error('Error: ffmpeg is not installed or not in PATH.');
        process.exit(1);
    }
};

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

const downloadFile = (url, output) => {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${url}" -c copy "${output}"`;
        exec(command, (error) => {
            if (error) {
                reject(`Failed to download ${output}: ${error.message}`);
            } else {
                resolve(`Downloaded: ${output}`);
            }
        });
    });
};

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
