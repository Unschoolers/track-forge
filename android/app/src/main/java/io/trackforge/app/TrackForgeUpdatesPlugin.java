package io.trackforge.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.Arrays;
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

    private long savedId() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(ID, -1);
    }

    private void forget() {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
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
        long id = savedId();
        JSObject result = id < 0 ? null : snapshot(id);
        if (result == null) {
            forget();
            result = new JSObject();
            result.put("state", "none");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        long id = savedId();
        if (id > 0) {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager != null) manager.remove(id);
        }
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

    private File downloadedFile() {
        String version = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(VERSION, "");
        if (!version.matches("android-build-[0-9]+-[0-9]+")) throw new IllegalStateException("Invalid update version.");
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "trackforge-" + version + ".apk");
    }

    @PluginMethod
    public void install(PluginCall call) {
        JSObject progress = savedId() < 0 ? null : snapshot(savedId());
        if (progress == null || !"complete".equals(progress.optString("state"))) {
            call.reject("Download is not complete.");
            return;
        }
        try {
            File apk = downloadedFile();
            if (!apk.isFile() || apk.length() <= 0) throw new IllegalStateException("Downloaded APK is missing.");
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
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
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
