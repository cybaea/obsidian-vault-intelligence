import { execFileSync } from 'child_process';

// Helper to run commands and return output cleanly
const run = (cmd, args = []) => {
    try {
        return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (error) {
        // When execFileSync fails, it throws. We catch it to allow custom handling if needed,
        // or just rethrow to stop execution.
        throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${error.message}\n${error.stderr || ''}`);
    }
};

// Helper to run commands where we want to see live output (like git push)
const runLive = (cmd, args = []) => {
    return execFileSync(cmd, args, { stdio: 'inherit' });
};

const type = (process.argv[2] || 'patch').replace(/[^a-zA-Z0-9.-]/g, '');

try {
    console.log("🔍 Performing safety checks...");

    // 1. SAFETY CHECK: Ensure working directory is clean
    // If there are uncommitted changes, 'git status --porcelain' returns a string.
    const gitStatus = run('git', ['status', '--porcelain']);
    if (gitStatus) {
        throw new Error(
            "❌ Working directory is not clean. Please commit or stash your changes before releasing.\n" +
            "Uncommitted files:\n" + gitStatus
        );
    }

    // 2. SAFETY CHECK: Ensure we are on a valid branch (optional, but good practice)
    // const currentBranch = run('git', ['branch', '--show-current']);
    // If you strictly only want to release from main, uncomment the next lines:
    /*
    if (currentBranch !== 'main') {
         // You might want to allow this if you want to switch FROM a feature branch TO main automatically,
         // but strictly enforcing being on main first is safer.
         console.log(`⚠️  Notice: You are on branch '${currentBranch}'. Switching to main...`);
    }
    */

    console.log("🔄 Syncing main branch...");
    // 3. Checkout and Pull
    runLive('git', ['checkout', 'main']);
    runLive('git', ['pull']);

    // 4. Calculate Version (Dry Run)
    const currentVersion = run('npm', ['pkg', 'get', 'version']).replace(/"/g, '');
    console.log(`🚀 Preparing ${type} release (Current: ${currentVersion})...`);

    // 5. Bump Version (modifies files)
    // We use runLive here because npm version might output important info or errors
    runLive('npm', ['version', type, '--no-git-tag-version']);

    const newVersion = run('npm', ['pkg', 'get', 'version']).replace(/"/g, '');
    const branchName = `release/${newVersion}`;

    console.log(`📦 Version bumped to ${newVersion}. Creating branch ${branchName}...`);

    // 6. Create Branch and Commit
    runLive('git', ['checkout', '-b', branchName]);
    runLive('git', ['add', '.']);
    runLive('git', ['commit', '-m', `chore: release ${newVersion}`]);

    // 7. Push
    console.log(`⬆️ Pushing branch...`);
    runLive('git', ['push', '-u', 'origin', branchName]);

    console.log(`\n✅ DONE! Open your PR here:\nhttps://github.com/cybaea/obsidian-vault-intelligence/compare/main...${branchName}`);

} catch (error) {
    console.error("\n🛑 RELEASE ABORTED");
    console.error(error.message);
    process.exit(1);
}