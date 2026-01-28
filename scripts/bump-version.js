import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';

try {
    // 1. Bump npm version
    console.log('Bumping npm version...');
    // --no-git-tag-version prevents npm from creating a git tag automatically; we'll do it manually.
    // This updates package.json and package-lock.json.
    const newVersion = execSync('npm version patch --no-git-tag-version').toString().trim().replace(/^v/, '');
    console.log(`New version: ${newVersion}`);

    // Paths
    const rootDir = process.cwd();
    const rootCargoPath = resolve(rootDir, 'Cargo.toml');
    const tauriDir = resolve(rootDir, 'src-tauri');
    const tauriConfPath = join(tauriDir, 'tauri.conf.json');
    const tauriCargoPath = join(tauriDir, 'Cargo.toml');

    // 2. Update Root Cargo.toml
    console.log('Updating root Cargo.toml...');
    let rootCargoCtx = readFileSync(rootCargoPath, 'utf8');
    // Replaces version under [workspace.package]
    rootCargoCtx = rootCargoCtx.replace(
        /(\[workspace\.package\][\s\S]*?version = ")([^"]+)(")/,
        `$1${newVersion}$3`
    );
    writeFileSync(rootCargoPath, rootCargoCtx);

    // 3. Update Tauri Cargo.toml
    console.log('Updating src-tauri/Cargo.toml...');
    let tauriCargoCtx = readFileSync(tauriCargoPath, 'utf8');
    // Replaces version under [package]
    tauriCargoCtx = tauriCargoCtx.replace(
        /(\[package\][\s\S]*?version = ")([^"]+)(")/,
        `$1${newVersion}$3`
    );
    writeFileSync(tauriCargoPath, tauriCargoCtx);

    // 4. Update tauri.conf.json
    console.log('Updating tauri.conf.json...');
    const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
    tauriConf.version = newVersion;
    // Use 2 spaces for indentation to match existing style.
    // Adding newline at EOF
    writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

    // 5. Git commands
    console.log('Executing git commands...');

    // Stage all changes
    execSync('git add .', { stdio: 'inherit' });

    // Commit
    execSync(`git commit -m "Bump to release v${newVersion}"`, { stdio: 'inherit' });

    // Tag
    execSync(`git tag v${newVersion}`, { stdio: 'inherit' });

    // Push tag
    execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });

    // Push branch changes
    execSync('git push', { stdio: 'inherit' });

    console.log(`Successfully bumped to v${newVersion}`);

} catch (error) {
    console.error('Error bumping version:', error);
    process.exit(1);
}
