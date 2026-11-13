package io.trackforge.app;

import androidx.core.content.FileProvider;

/** Keeps the share cache separate from Capacitor's general file provider. */
public final class TrackShareProvider extends FileProvider {}
