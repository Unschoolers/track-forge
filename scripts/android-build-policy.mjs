import { readFileSync } from 'node:fs'

function verifyMetadata(file, code, name) {
	const metadata = readFileSync(file, 'utf8').match(
		/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m,
	)
	if (
		metadata?.[1] !== 'io.trackforge.app' ||
		metadata?.[2] !== code ||
		metadata?.[3] !== name
	) {
		throw new Error(
			'APK application id or version differs from the requested build',
		)
	}
}

try {
	const [mode, ...args] = process.argv.slice(2)
	if (mode === 'version' && args.length === 2) {
		const [run, attempt] = args.map(Number)
		if (
			!Number.isSafeInteger(run) ||
			run < 1 ||
			!Number.isSafeInteger(attempt) ||
			attempt < 1 ||
			attempt > 99
		) {
			throw new Error(
				'Build number must be a positive integer; attempt must be between 1 and 99',
			)
		}
		const code = 1_000_000 + run * 100 + attempt
		if (!Number.isSafeInteger(code) || code > 2_100_000_000)
			throw new Error('Android versionCode limit exceeded')
		console.log(
			`TRACKFORGE_VERSION_CODE=${code}\nTRACKFORGE_VERSION_NAME=2.0.${run}.${attempt}\nTRACKFORGE_BUILD_RUN=${run}\nTRACKFORGE_BUILD_ATTEMPT=${attempt}`,
		)
	} else if (mode === 'metadata' && args.length === 3) {
		verifyMetadata(...args)
		console.log(`Verified Android metadata: ${args[2]} (${args[1]})`)
	} else if (mode === 'verify' && args.length === 4) {
		const [badgingFile, certsFile, expectedCode, expectedName] = args
		verifyMetadata(badgingFile, expectedCode, expectedName)
		const certs = readFileSync(certsFile, 'utf8')
		const expectedSigner = readFileSync(
			new URL('../android/signing-certificate.sha256', import.meta.url),
			'utf8',
		)
			.trim()
			.toLowerCase()
		if (!/^[a-f0-9]{64}$/.test(expectedSigner))
			throw new Error('Invalid pinned signing certificate')
		const signers = [
			...certs.matchAll(
				/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)\r?$/gm,
			),
		]
		if (
			signers.length !== 1 ||
			signers[0][1].toLowerCase() !== expectedSigner
		) {
			throw new Error(
				'APK signing certificate changed; refusing to distribute an incompatible update',
			)
		}
		console.log(
			`Verified Android identity: io.trackforge.app ${expectedName} (${expectedCode}), signer ${expectedSigner}`,
		)
	} else {
		throw new Error(
			'Use version RUN ATTEMPT or verify BADGING CERTIFICATES CODE NAME',
		)
	}
} catch (error) {
	console.error(`Android build policy: ${error.message}`)
	process.exitCode = 1
}
