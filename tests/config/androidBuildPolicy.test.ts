// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporary: string[] = []
afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true })
})

function policy(...args: string[]) {
	return execFileSync(
		process.execPath,
		['scripts/android-build-policy.mjs', ...args],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
}
function version(run: string, attempt: string) {
	return Object.fromEntries(
		policy('version', run, attempt)
			.trim()
			.split('\n')
			.map((line) => line.split('=')),
	)
}

describe('Android build identity', () => {
	it('increases version codes across builds and reruns and exposes the build in versionName', () => {
		const first = version('116', '1')
		const rerun = version('116', '2')
		const next = version('117', '1')
		expect(Number(first.TRACKFORGE_VERSION_CODE)).toBeGreaterThan(118)
		expect(Number(rerun.TRACKFORGE_VERSION_CODE)).toBeGreaterThan(
			Number(first.TRACKFORGE_VERSION_CODE),
		)
		expect(Number(next.TRACKFORGE_VERSION_CODE)).toBeGreaterThan(
			Number(rerun.TRACKFORGE_VERSION_CODE),
		)
		expect(next.TRACKFORGE_VERSION_NAME).toBe('2.0.117.1')
	})

	it.each([
		['0', '1'],
		['1', '0'],
		['1', '100'],
		['1.5', '1'],
		['NaN', '1'],
		['999999999', '1'],
	])(
		'rejects invalid or overflowing build identifiers %s/%s',
		(run, attempt) => {
			expect(() => version(run, attempt)).toThrow()
		},
	)

	it('rejects a real legacy APK certificate instead of distributing another incompatible update', () => {
		const directory = mkdtempSync(join(tmpdir(), 'trackforge-apk-policy-'))
		temporary.push(directory)
		const badging = join(directory, 'badging.txt')
		const certs = join(directory, 'certs.txt')
		writeFileSync(
			badging,
			"package: name='io.trackforge.app' versionCode='1011701' versionName='2.0.117.1'\n",
		)
		const pinned = readFileSync(
			'android/signing-certificate.sha256',
			'utf8',
		).trim()
		writeFileSync(certs, `Signer #1 certificate SHA-256 digest: ${pinned}\n`)
		expect(policy('verify', badging, certs, '1011701', '2.0.117.1')).toContain(
			'Verified Android identity',
		)
		// Published build 116 used this other signer, despite the same application id.
		writeFileSync(
			certs,
			'Signer #1 certificate SHA-256 digest: e804bcda903360172a097865c3e6a83ffd3c3bc0ada101f6a99d8dbde9d34786\n',
		)
		expect(() =>
			policy('verify', badging, certs, '1011701', '2.0.117.1'),
		).toThrow()
		writeFileSync(certs, `Signer #1 certificate SHA-256 digest: ${pinned}\n`)
		writeFileSync(
			badging,
			"package: name='io.other.app' versionCode='1011701' versionName='2.0.117.1'\n",
		)
		expect(() =>
			policy('verify', badging, certs, '1011701', '2.0.117.1'),
		).toThrow()
		writeFileSync(
			badging,
			"package: name='io.trackforge.app' versionCode='3' versionName='2.0.0'\n",
		)
		expect(() =>
			policy('verify', badging, certs, '1011701', '2.0.117.1'),
		).toThrow()
	})

	it('requires the persistent key and pinned certificate before publication', () => {
		const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
		expect(workflow).not.toContain('keytool -genkeypair')
		expect(workflow).not.toContain('trackforge-debug-keystore-v1')
		expect(workflow).toContain('environment: android-signing')
		expect(workflow).toContain('android/signing-certificate.sha256')
		expect(workflow).toContain('scripts/android-build-policy.mjs verify')
		expect(workflow).toContain('TRACKFORGE_DEBUG_KEYSTORE_BASE64')
	})

	it('keeps the signing key out of PR builds and signs only in the restricted main environment', () => {
		const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
		const [build, signing] = workflow.split('\n  sign-and-release:')
		expect(build).not.toContain('secrets.TRACKFORGE_DEBUG_KEYSTORE_BASE64')
		expect(signing).toContain('environment: android-signing')
		expect(signing).toContain("github.ref == 'refs/heads/main'")
		expect(signing).not.toContain('./gradlew')
		expect(signing).toContain('apksigner')
		expect(signing).toMatch(/BUILD_ATTEMPT: \$\{\{ needs\.android\.outputs\.build_attempt \}\}/)
		expect(signing).toMatch(/tag="android-build-\$\{BUILD_RUN\}-\$\{BUILD_ATTEMPT\}"/)
	})

	it('checks unsigned build metadata without requiring a private signing key', () => {
		const directory = mkdtempSync(join(tmpdir(), 'trackforge-apk-metadata-'))
		temporary.push(directory)
		const badging = join(directory, 'badging.txt')
		writeFileSync(
			badging,
			"package: name='io.trackforge.app' versionCode='1011701' versionName='2.0.117.1'\n",
		)
		expect(policy('metadata', badging, '1011701', '2.0.117.1')).toContain(
			'Verified Android metadata',
		)
		const identity = version('117', '1')
		expect(identity.TRACKFORGE_BUILD_RUN).toBe('117')
		expect(identity.TRACKFORGE_BUILD_ATTEMPT).toBe('1')
	})
})
