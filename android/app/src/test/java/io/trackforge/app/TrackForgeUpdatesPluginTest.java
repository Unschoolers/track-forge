package io.trackforge.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.SharedPreferences;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class TrackForgeUpdatesPluginTest {
    @Test public void stagesDownloadedApkInPrivateCache() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        byte[] apk = "sample-apk-payload".getBytes(StandardCharsets.UTF_8);
        long id = 88001;
        java.io.File staged = TrackForgeUpdatesPlugin.copyApkToPrivateCache(
                context, new ByteArrayInputStream(apk), id);
        try {
            assertEquals(TrackForgeUpdatesPlugin.stagedFile(context, id), staged);
            assertTrue(staged.getCanonicalPath().startsWith(context.getCacheDir().getCanonicalPath()));
            assertArrayEquals(apk, Files.readAllBytes(staged.toPath()));
        } finally {
            staged.delete();
        }
    }

    @Test public void failedCopyRemovesPartialApk() {
        Context context = RuntimeEnvironment.getApplication();
        long id = 88002;
        InputStream broken = new InputStream() {
            private int readCount;
            @Override public int read() throws IOException {
                if (readCount++ == 0) return 42;
                throw new IOException("download interrupted");
            }
        };
        try {
            TrackForgeUpdatesPlugin.copyApkToPrivateCache(context, broken, id);
            fail("Expected a failed download stream to abort staging");
        } catch (IOException expected) {
            assertEquals("download interrupted", expected.getMessage());
        }
        assertFalse(TrackForgeUpdatesPlugin.stagedFile(context, id).exists());
    }

    @Test public void emptyDownloadsCannotBeInstalled() {
        Context context = RuntimeEnvironment.getApplication();
        long id = 88003;
        try {
            TrackForgeUpdatesPlugin.copyApkToPrivateCache(context, new ByteArrayInputStream(new byte[0]), id);
            fail("Expected empty download to be rejected");
        } catch (IOException expected) {
            assertEquals("Downloaded APK is empty.", expected.getMessage());
        }
        assertFalse(TrackForgeUpdatesPlugin.stagedFile(context, id).exists());
    }

    @Test(expected = IllegalArgumentException.class)
    public void invalidDownloadIdCannotBecomeCachePath() {
        TrackForgeUpdatesPlugin.stagedFile(RuntimeEnvironment.getApplication(), -1);
    }

    @Test public void installedApkClearsPreviouslyDownloadedVersionAndStagedFile() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        SharedPreferences prefs = context.getSharedPreferences("trackforge_updates", Context.MODE_PRIVATE);
        long id = 88004;
        prefs.edit().putLong("downloadId", id).putString("version", "android-build-908-1").commit();
        java.io.File staged = TrackForgeUpdatesPlugin.copyApkToPrivateCache(
                context, new ByteArrayInputStream(new byte[]{1, 2, 3}), id);
        try {
            assertTrue(TrackForgeUpdatesPlugin.clearInstalledDownload(context, 1_090_801L));
            assertEquals(-1L, prefs.getLong("downloadId", -1));
            assertNull(prefs.getString("version", null));
            assertFalse(staged.exists());
        } finally {
            prefs.edit().clear().commit();
            staged.delete();
        }
    }

    @Test public void cancelledInstallationKeepsNewerApkAvailableForRetry() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        SharedPreferences prefs = context.getSharedPreferences("trackforge_updates", Context.MODE_PRIVATE);
        long id = 88005;
        prefs.edit().putLong("downloadId", id).putString("version", "android-build-909-1").commit();
        java.io.File staged = TrackForgeUpdatesPlugin.copyApkToPrivateCache(
                context, new ByteArrayInputStream(new byte[]{1, 2, 3}), id);
        try {
            assertFalse(TrackForgeUpdatesPlugin.clearInstalledDownload(context, 1_090_801L));
            assertEquals(id, prefs.getLong("downloadId", -1));
            assertTrue(staged.exists());
        } finally {
            prefs.edit().clear().commit();
            staged.delete();
        }
    }

    @Test public void releaseComparisonHandlesNewerInstalledVersionAndInvalidTags() {
        assertTrue(TrackForgeUpdatesPlugin.isInstalledVersionAtLeast("android-build-908-1", 1_091_001L));
        assertFalse(TrackForgeUpdatesPlugin.isInstalledVersionAtLeast("android-build-909-1", 1_090_801L));
        assertFalse(TrackForgeUpdatesPlugin.isInstalledVersionAtLeast("android-build-908-100", 1_090_900L));
        assertFalse(TrackForgeUpdatesPlugin.isInstalledVersionAtLeast("android-build-not-a-build", 1_090_801L));
        assertFalse(TrackForgeUpdatesPlugin.isInstalledVersionAtLeast("android-build-999999999999999999999999-1", Long.MAX_VALUE));
    }
}
