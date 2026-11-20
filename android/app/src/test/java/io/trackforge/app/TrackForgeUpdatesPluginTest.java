package io.trackforge.app;

import static org.junit.Assert.*;
import android.content.Context;
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
}
