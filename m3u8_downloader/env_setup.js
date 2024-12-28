import { execSync } from 'child_process';
import fs from 'fs';

// Minimum Node.js version required
const MIN_NODE_VERSION = '16.0.0';

// Required npm packages
const REQUIRED_PACKAGES = [
    'node-fetch',
    'fluent-ffmpeg',
    'ffmpeg-static',
    'node-m3u8-downloader',
    'prompts'
];

// Install a missing npm package
async function installPackage(pkg) {
    try {
        console.log(`Installing package "${pkg}"...`);
        execSync(`npm install ${pkg}`, { stdio: 'inherit' });
        console.log(`✅ "${pkg}" has been installed.`);
    } catch (error) {
        console.error(`❌ Failed to install package "${pkg}":`, error.message);
    }
}

// Check Node.js version
function checkNodeVersion() {
    const nodeVersion = process.version.slice(1); // Remove the 'v' prefix
    if (compareVersions(nodeVersion, MIN_NODE_VERSION) < 0) {
        console.error(`❌ Node.js v${MIN_NODE_VERSION} or higher is required. You have v${nodeVersion}.`);
        process.exit(1);
    } else {
        console.log(`✅ Node.js version v${nodeVersion} meets the requirement.`);
    }
}

// Compare semantic version strings (e.g., "16.0.0" vs "14.0.0")
function compareVersions(version1, version2) {
    const [v1, v2] = [version1.split('.'), version2.split('.')];
    for (let i = 0; i < v1.length; i++) {
        if (parseInt(v1[i]) > parseInt(v2[i])) return 1;
        if (parseInt(v1[i]) < parseInt(v2[i])) return -1;
    }
    return 0;
}

// Check for required npm packages and install if missing
async function checkNpmPackages() {
    console.log('\nChecking required npm packages:');
    for (const pkg of REQUIRED_PACKAGES) {
        try {
            await import(pkg); // Dynamically check for ESM-compatible modules
            console.log(`✅ "${pkg}" has been found.`);
        } catch {
            console.error(`❌ "${pkg}" is missing.`);
            await installPackage(pkg);
        }
    }
}

// Check for FFmpeg availability
async function checkFFmpeg() {
    try {
        // Dynamically import ffmpeg-static
        const { default: ffmpegPath } = await import('ffmpeg-static');
        if (fs.existsSync(ffmpegPath)) {
            console.log('✅ FFmpeg is available via ffmpeg-static.');
            return;
        }
    } catch {
        // Ignore if ffmpeg-static is not found
    }

    try {
        // Try globally installed ffmpeg
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log('✅ FFmpeg is globally installed.');
    } catch {
        console.error(
            '❌ FFmpeg is not available. Install it via "ffmpeg-static" (automatic) or globally:'
        );
        console.log(
            '- macOS: "brew install ffmpeg"\n' +
            '- Linux: "sudo apt install ffmpeg"\n' +
            '- Windows: Download and install from https://ffmpeg.org/download.html'
        );
        process.exit(1);
    }
}

// Main function
async function main() {
    console.log('Running environment setup...\n');

    // Perform all checks
    checkNodeVersion();
    await checkNpmPackages();
    await checkFFmpeg();

    console.log('\n✅ Environment setup completed successfully! You are ready to run the main script.');
}

// Run the script
main();
