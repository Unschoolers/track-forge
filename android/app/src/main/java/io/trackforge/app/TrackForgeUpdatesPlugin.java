package io.trackforge.app;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import android.content.pm.PackageInfo;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Download an official GitHub Release APK via Android's system Download Manager. */
@CapacitorPlugin(name = "TrackForgeUpdates")
public class TrackForgeUpdatesPlugin extends Plugin {
    private static final String PREFS = "trackforge_updates";
    private static final String ID = "downloadId";
    private static final String VERSION = "version";
    private static final Pattern RELEASE_TAG = Pattern.compile("^android-build-(\\d+)-(\\d+)$");
    private static final long RELEASE_VERSION_OFFSET = 1_000_000L;
    private static final long MAX_APK_BYTES = 256L * 1024 * 1024;

    private long savedId() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(ID, -1);
    }

    private void forget() {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    /** Android versionCode and release tag follow scripts/android-build-policy.mjs. */
    static boolean isInstalledVersionAtLeast(String releaseTag, long installedCode) {
        if (releaseTag == null || installedCode <= 0) return false;
        Matcher match = RELEASE_TAG.matcher(releaseTag);
        if (!match.matches()) return false;
        try {
            long run = Long.parseLong(match.group(1));
            long attempt = Long.parseLong(match.group(2));
            if (run < 1 || attempt < 1 || attempt > 99) return false;
            long releaseCode = Math.addExact(RELEASE_VERSION_OFFSET,
                    Math.addExact(Math.multiplyExact(run, 100L), attempt));
            return installedCode >= releaseCode;
        } catch (NumberFormatException | ArithmeticException invalidRelease) {
            return false;
        }
    }

    /**
     * An installed APK is the source of truth. Keep a downloaded APK until Android
     * really installs its version (or a newer one), even if the installer opened.
     */
    static boolean clearInstalledDownload(Context context, long installedCode) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long id = prefs.getLong(ID, -1);
        if (id <= 0 || !isInstalledVersionAtLeast(prefs.getString(VERSION, ""), installedCode)) {
            return false;
        }
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new IllegalStateException("Android Download Manager is unavailable.");
        manager.remove(id);
        File staged = stagedFile(context, id);
        if (staged.exists() && !staged.delete()) {
            throw new IllegalStateException("Could not remove the obsolete staged APK.");
        }
        prefs.edit().clear().apply();
        return true;
    }

    private void clearIfAlreadyInstalled() {
        if (savedId() <= 0) return;
        try {
            Context context = getContext();
            PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long installedCode = Build.VERSION.SDK_INT >= 28
                    ? installed.getLongVersionCode() : installed.versionCode;
            clearInstalledDownload(context, installedCode);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("Could not read installed Track Forge version.", error);
        }
    }

    /** Download Manager owns the public download; the installer needs a private, readable copy. */
    static File stagedFile(Context context, long downloadId) {
        if (downloadId <= 0) throw new IllegalArgumentException("Invalid download ID.");
        return new File(new File(context.getCacheDir(), "updates"), "trackforge-" + downloadId + ".apk");
    }

    static File copyApkToPrivateCache(Context context, InputStream source, long downloadId) throws IOException {
        File destination = stagedFile(context, downloadId);
        File directory = destination.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create private APK cache.");
        }
        boolean complete = false;
        try {
            long copied = 0;
            try (FileOutputStream target = new FileOutputStream(destination)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = source.read(buffer)) != -1) {
                    copied += count;
                    if (copied > MAX_APK_BYTES) throw new IOException("Downloaded APK is too large.");
                    target.write(buffer, 0, count);
                }
            }
            if (copied == 0) throw new IOException("Downloaded APK is empty.");
            complete = true;
            return destination;
        } finally {
            if (!complete) destination.delete();
        }
    }

    private File stageDownloadedApk(DownloadManager manager, long downloadId) throws IOException {
        try (ParcelFileDescriptor descriptor = manager.openDownloadedFile(downloadId);
             InputStream source = new FileInputStream(descriptor.getFileDescriptor())) {
            return copyApkToPrivateCache(getContext(), source, downloadId);
        }
    }

    private JSObject snapshot(long id) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new IllegalStateException("Android Download Manager is unavailable.");
        try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            JSObject result = new JSObject();
            result.put("downloadId", id);
            result.put("version", getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(VERSION, ""));
            result.put("downloaded", downloaded);
            result.put("total", total);
            result.put("state", status == DownloadManager.STATUS_SUCCESSFUL ? "complete"
                    : status == DownloadManager.STATUS_FAILED ? "failed"
                    : status == DownloadManager.STATUS_PAUSED ? "paused"
                    : status == DownloadManager.STATUS_RUNNING ? "downloading" : "pending");
            return result;
        }
    }

    @PluginMethod
    public void current(PluginCall call) {
        try {
            clearIfAlreadyInstalled();
            long id = savedId();
            JSObject result = id < 0 ? null : snapshot(id);
            if (result == null) {
                forget();
                result = new JSObject();
                result.put("state", "none");
            }
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not check saved APK download: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        long id = savedId();
        if (id > 0) {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager != null) manager.remove(id);
        }
        if (id > 0) stagedFile(getContext(), id).delete();
        forget();
        call.resolve();
    }

    private boolean sameSigner(PackageInfo candidate, PackageInfo installed) {
        if (Build.VERSION.SDK_INT >= 28) {
            return candidate.signingInfo != null && installed.signingInfo != null
                    && Arrays.equals(candidate.signingInfo.getApkContentsSigners(), installed.signingInfo.getApkContentsSigners());
        }
        return candidate.signatures != null && installed.signatures != null
                && candidate.signatures.length > 0 && Arrays.equals(candidate.signatures, installed.signatures);
    }

    @PluginMethod
    public void install(PluginCall call) {
        long id = savedId();
        JSObject progress = id < 0 ? null : snapshot(id);
        if (progress == null || !"complete".equals(progress.optString("state"))) {
            call.reject("Download is not complete.");
            return;
        }
        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("Android Download Manager is unavailable.");
            // Public Downloads is not directly readable through File on recent Android releases.
            File apk = stageDownloadedApk(manager, id);
            PackageManager pm = getContext().getPackageManager();
            int signingFlag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo candidate = pm.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlag);
            PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), signingFlag);
            if (candidate == null || !getContext().getPackageName().equals(candidate.packageName)
                    || !sameSigner(candidate, installed)) {
                throw new SecurityException("APK package or signing certificate does not match Track Forge.");
            }
            long candidateCode = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
            long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            if (candidateCode <= installedCode) throw new SecurityException("Downloaded APK is not a newer version.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                JSObject result = new JSObject();
                result.put("state", "permission-required");
                call.resolve(result);
                return;
            }

            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("Track Forge update", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("state", "installer-opened");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not verify or open the APK installer: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void progress(PluginCall call) {
        Long requested = call.getLong("downloadId");
        long id = savedId();
        if (requested == null || requested != id || id < 0) {
            call.reject("Download is not tracked by Track Forge.");
            return;
        }
        JSObject result = snapshot(id);
        if (result == null) {
            forget();
            call.reject("Download no longer exists.");
            return;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version");
        if (url == null || version == null ||
                !version.matches("android-build-[0-9]+-[0-9]+") ||
                !url.equals("https://github.com/Unschoolers/track-forge/releases/download/" + version + "/trackforge-debug.apk")) {
            call.reject("Invalid official Track Forge release URL.");
            return;
        }
        try {
            clearIfAlreadyInstalled();
            long previous = savedId();
            if (previous > 0) {
                JSObject active = snapshot(previous);
                if (active != null && !"failed".equals(active.optString("state"))) {
                    if (version.equals(active.optString("version"))) {
                        call.resolve(active);
                        return;
                    }
                    call.reject("Another update is already downloaded or in progress. Cancel it first.");
                    return;
                }
                DownloadManager existing = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                if (existing != null) existing.remove(previous);
                stagedFile(getContext(), previous).delete();
                forget();
            }
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Track Forge " + version);
            request.setDescription("Game update APK");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "trackforge-" + version + ".apk");
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Android Download Manager is unavailable.");
                return;
            }
            long downloadId = manager.enqueue(request);
            JSObject result = new JSObject();
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(ID, downloadId).putString(VERSION, version).apply();
            result.put("downloadId", downloadId);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not start APK download.", error);
        }
    }
}
