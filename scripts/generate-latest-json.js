
const fs = require('fs');

async function generateLatestJson() {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO = process.env.GITHUB_REPOSITORY; // "owner/repo"
    const TAG = process.env.GITHUB_REF_NAME; // "v1.0.0"

    if (!GITHUB_TOKEN) {
        console.error("Error: GITHUB_TOKEN is not set.");
        process.exit(1);
    }

    console.log(`Generating latest.json for ${REPO} tag ${TAG}...`);

    try {
        const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
            headers: {
                "Authorization": `token ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "generate-latest-json-script"
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch release: ${response.status} ${response.statusText}`);
        }

        const release = await response.json();
        const assets = release.assets;

        console.log(`Found ${assets.length} assets.`);
        assets.forEach(a => console.log(` - ${a.name}`));

        const platforms = {
            "darwin-aarch64": {
                regex: /_aarch64\.app\.tar\.gz$/,
                signature: null,
                url: null
            },
            "darwin-x86_64": {
                regex: /_x64\.app\.tar\.gz$/,
                signature: null,
                url: null
            },
            "linux-x86_64": {
                regex: /\.AppImage$/,
                signature: null,
                url: null
            },
            "windows-x86_64": {
                regex: /-setup\.exe$/,  // Standard Tauri setup exe naming
                signature: null,
                url: null
            }
        };

        // First pass: find binaries
        for (const asset of assets) {
            for (const [key, config] of Object.entries(platforms)) {
                if (config.regex.test(asset.name)) {
                    config.url = asset.browser_download_url;
                    console.log(`Matched ${key} binary: ${asset.name}`);
                }
            }
        }

        // Second pass: find signatures
        // Tauri updater expects the signature file to be exactly {binary_filename}.sig
        for (const asset of assets) {
            if (!asset.name.endsWith('.sig')) continue;

            // Check which binary this signature belongs to
            const binaryName = asset.name.slice(0, -4); // remove .sig

            for (const [key, config] of Object.entries(platforms)) {
                // We need to check if we found a URL for this platform first
                // And if the binary name matches the asset name of the URL we found
                if (config.url && config.url.endsWith(binaryName)) {
                    // Fetch the signature content
                    console.log(`Matched signature for ${key}: ${asset.name}`);
                    const sigResponse = await fetch(asset.browser_download_url);
                    if (sigResponse.ok) {
                        config.signature = await sigResponse.text();
                        config.signature = config.signature.trim();
                    } else {
                        console.error(`Failed to download signature ${asset.name}`);
                    }
                }
            }
        }

        const output = {
            version: release.tag_name.replace(/^v/, ''), // Remove 'v' prefix if present
            notes: release.body,
            pub_date: release.published_at,
            platforms: {}
        };

        let foundAny = false;
        for (const [key, config] of Object.entries(platforms)) {
            if (config.url) {
                if (!config.signature) {
                    console.warn(`WARNING: Missing signature for ${key}. This platform will be omitted from latest.json.`);
                    // In strict mode we might want to fail here. 
                    // For now, let's omit it so at least valid platforms work.
                    continue;
                }

                output.platforms[key] = {
                    signature: config.signature,
                    url: config.url
                };
                foundAny = true;
            }
        }

        if (!foundAny) {
            console.error("Error: No valid platforms found with both binary and signature.");
            // We exit successfully to not fail the workflow entirely if it's a partial release, 
            // but this is definitely an error state for a full release.
            // Let's create an empty file or fail? Faling is better for visibility.
            process.exit(1);
        }

        const jsonString = JSON.stringify(output, null, 2);
        fs.writeFileSync('latest.json', jsonString);
        console.log("Successfully generated latest.json");
        console.log(jsonString);

    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

generateLatestJson();
